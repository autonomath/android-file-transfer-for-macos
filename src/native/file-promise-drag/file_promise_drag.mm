#import <AppKit/AppKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

#include <napi.h>

#include <algorithm>
#include <cerrno>
#include <cstring>
#include <memory>
#include <mutex>
#include <stdio.h>
#include <string>
#include <unordered_map>
#include <vector>

struct NativeEvent {
  std::string type;
  std::string promiseId;
  std::string path;
  std::string message;
  bool active = false;
  unsigned long operation = 0;
};

struct PendingWrite {
  dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
  std::string error;
};

class BridgeState {
 public:
  explicit BridgeState(Napi::ThreadSafeFunction callback)
      : callback_(std::move(callback)) {}

  ~BridgeState() {
    FailAll("The drag session ended before the file could be delivered.");
    callback_.Release();
  }

  void Emit(NativeEvent event) {
    auto* payload = new NativeEvent(std::move(event));
    napi_status status = callback_.NonBlockingCall(
        payload,
        [](Napi::Env env, Napi::Function callback, NativeEvent* value) {
          Napi::Object eventObject = Napi::Object::New(env);
          eventObject.Set("type", value->type);
          if (!value->promiseId.empty()) {
            eventObject.Set("promiseId", value->promiseId);
          }
          if (!value->path.empty()) {
            eventObject.Set("path", value->path);
          }
          if (!value->message.empty()) {
            eventObject.Set("message", value->message);
          }
          if (value->type == "internal-hover") {
            eventObject.Set("active", value->active);
          }
          if (value->type == "drag-ended") {
            eventObject.Set("operation", Napi::Number::New(env, value->operation));
          }
          callback.Call({eventObject});
          delete value;
        });
    if (status != napi_ok) {
      delete payload;
    }
  }

  std::shared_ptr<PendingWrite> BeginWrite(const std::string& promiseId) {
    auto pending = std::make_shared<PendingWrite>();
    std::lock_guard<std::mutex> lock(mutex_);
    pending_[promiseId] = pending;
    return pending;
  }

  bool Complete(const std::string& promiseId, const std::string& error) {
    std::shared_ptr<PendingWrite> pending;
    {
      std::lock_guard<std::mutex> lock(mutex_);
      auto found = pending_.find(promiseId);
      if (found == pending_.end()) {
        return false;
      }
      pending = found->second;
      pending_.erase(found);
    }
    pending->error = error;
    dispatch_semaphore_signal(pending->semaphore);
    return true;
  }

  void FailAll(const std::string& error) {
    std::unordered_map<std::string, std::shared_ptr<PendingWrite>> pending;
    {
      std::lock_guard<std::mutex> lock(mutex_);
      pending.swap(pending_);
    }
    for (auto& [_, write] : pending) {
      write->error = error;
      dispatch_semaphore_signal(write->semaphore);
    }
  }

 private:
  Napi::ThreadSafeFunction callback_;
  std::mutex mutex_;
  std::unordered_map<std::string, std::shared_ptr<PendingWrite>> pending_;
};

@interface MTPPromiseRecord : NSObject
@property(nonatomic, copy) NSString* promiseId;
@property(nonatomic, copy) NSString* name;
@property(nonatomic, copy) NSString* kind;
@end

@implementation MTPPromiseRecord
@end

@class MTPPromiseCoordinator;

@interface MTPPromiseDropView : NSView <NSDraggingDestination>
@property(nonatomic, weak) MTPPromiseCoordinator* coordinator;
@property(nonatomic, copy) NSString* destinationPath;
@end

@interface MTPPromiseCoordinator : NSObject <NSFilePromiseProviderDelegate, NSDraggingSource>
@property(nonatomic, strong) NSOperationQueue* promiseQueue;
@property(nonatomic, strong) MTPPromiseDropView* dropView;
- (instancetype)initWithState:(std::shared_ptr<BridgeState>)state;
- (void)emitHover:(BOOL)active;
@end

@implementation MTPPromiseDropView

- (BOOL)isOpaque {
  return NO;
}

- (void)drawRect:(NSRect)dirtyRect {
  (void)dirtyRect;
}

- (NSDragOperation)draggingEntered:(id<NSDraggingInfo>)sender {
  NSArray* receivers = [sender.draggingPasteboard readObjectsForClasses:@[[NSFilePromiseReceiver class]]
                                                                 options:nil];
  if (receivers.count == 0 || self.destinationPath.length == 0) {
    return NSDragOperationNone;
  }
  [self.coordinator emitHover:YES];
  return NSDragOperationCopy;
}

- (NSDragOperation)draggingUpdated:(id<NSDraggingInfo>)sender {
  (void)sender;
  return self.destinationPath.length > 0 ? NSDragOperationCopy : NSDragOperationNone;
}

- (void)draggingExited:(id<NSDraggingInfo>)sender {
  (void)sender;
  [self.coordinator emitHover:NO];
}

- (BOOL)performDragOperation:(id<NSDraggingInfo>)sender {
  NSArray<NSFilePromiseReceiver*>* receivers =
      [sender.draggingPasteboard readObjectsForClasses:@[[NSFilePromiseReceiver class]] options:nil];
  if (receivers.count == 0 || self.destinationPath.length == 0) {
    return NO;
  }

  NSURL* destination = [NSURL fileURLWithPath:self.destinationPath isDirectory:YES];
  NSOperationQueue* receiverQueue = [[NSOperationQueue alloc] init];
  receiverQueue.maxConcurrentOperationCount = 1;
  for (NSFilePromiseReceiver* receiver in receivers) {
    [receiver receivePromisedFilesAtDestination:destination
                                        options:@{}
                                 operationQueue:receiverQueue
                                         reader:^(NSURL* fileURL, NSError* error) {
      (void)fileURL;
      (void)error;
    }];
  }
  [self.coordinator emitHover:NO];
  return YES;
}

@end

@implementation MTPPromiseCoordinator {
  std::shared_ptr<BridgeState> _state;
}

- (instancetype)initWithState:(std::shared_ptr<BridgeState>)state {
  self = [super init];
  if (self) {
    _state = std::move(state);
    _promiseQueue = [[NSOperationQueue alloc] init];
    _promiseQueue.name = @"io.github.autonomath.androidfiletransfer.file-promises";
    _promiseQueue.maxConcurrentOperationCount = 1;
  }
  return self;
}

- (void)emitHover:(BOOL)active {
  _state->Emit({.type = "internal-hover", .active = active == YES});
}

- (NSString*)filePromiseProvider:(NSFilePromiseProvider*)provider
              fileNameForType:(NSString*)fileType {
  (void)fileType;
  MTPPromiseRecord* record = (MTPPromiseRecord*)provider.userInfo;
  return record.name;
}

- (NSOperationQueue*)operationQueueForFilePromiseProvider:(NSFilePromiseProvider*)provider {
  (void)provider;
  return self.promiseQueue;
}

- (void)filePromiseProvider:(NSFilePromiseProvider*)provider
          writePromiseToURL:(NSURL*)url
          completionHandler:(void (^)(NSError* _Nullable))completionHandler {
  MTPPromiseRecord* record = (MTPPromiseRecord*)provider.userInfo;
  std::string promiseId = record.promiseId.UTF8String ?: "";
  std::string destinationPath = url.path.UTF8String ?: "";
  auto pending = _state->BeginWrite(promiseId);

  __block NSError* coordinationError = nil;
  NSFileCoordinator* coordinator = [[NSFileCoordinator alloc] initWithFilePresenter:nil];
  [coordinator coordinateWritingItemAtURL:url
                                  options:0
                                    error:&coordinationError
                               byAccessor:^(NSURL* coordinatedURL) {
    _state->Emit({
        .type = "write",
        .promiseId = promiseId,
        .path = coordinatedURL.path.UTF8String ?: destinationPath
    });
    dispatch_semaphore_wait(pending->semaphore, DISPATCH_TIME_FOREVER);
  }];

  if (coordinationError) {
    completionHandler(coordinationError);
    return;
  }
  if (!pending->error.empty()) {
    NSString* description = [NSString stringWithUTF8String:pending->error.c_str()];
    NSError* error = [NSError errorWithDomain:@"io.github.autonomath.androidfiletransfer.file-promise"
                                         code:1
                                     userInfo:@{NSLocalizedDescriptionKey : description}];
    completionHandler(error);
    return;
  }
  completionHandler(nil);
}

- (NSDragOperation)draggingSession:(NSDraggingSession*)session
    sourceOperationMaskForDraggingContext:(NSDraggingContext)context {
  (void)session;
  (void)context;
  return NSDragOperationCopy;
}

- (BOOL)ignoreModifierKeysForDraggingSession:(NSDraggingSession*)session {
  (void)session;
  return YES;
}

- (void)draggingSession:(NSDraggingSession*)session
           endedAtPoint:(NSPoint)screenPoint
              operation:(NSDragOperation)operation {
  (void)session;
  (void)screenPoint;
  [self.dropView removeFromSuperview];
  self.dropView = nil;
  _state->Emit({.type = "drag-ended", .operation = operation});
}

@end

std::mutex gCoordinatorMutex;
MTPPromiseCoordinator* gCoordinator = nil;
NSMutableDictionary<NSString*, MTPPromiseCoordinator*>* gPromiseCoordinators;
std::unordered_map<std::string, std::shared_ptr<BridgeState>> gPromiseStates;

NSString* StringValue(const Napi::Object& object, const char* key) {
  Napi::Value value = object.Get(key);
  if (!value.IsString()) {
    return @"";
  }
  return [NSString stringWithUTF8String:value.As<Napi::String>().Utf8Value().c_str()];
}

Napi::Value StartDrag(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsFunction()) {
    Napi::TypeError::New(env, "startDrag requires an options object and callback").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  Napi::Object options = info[0].As<Napi::Object>();
  Napi::Value handleValue = options.Get("viewHandle");
  Napi::Value itemsValue = options.Get("items");
  if (!handleValue.IsBuffer() || !itemsValue.IsArray()) {
    Napi::TypeError::New(env, "startDrag requires viewHandle and items").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  Napi::Buffer<uint8_t> handle = handleValue.As<Napi::Buffer<uint8_t>>();
  if (handle.Length() < sizeof(void*)) {
    Napi::TypeError::New(env, "The native view handle is invalid").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  void* pointer = nullptr;
  memcpy(&pointer, handle.Data(), sizeof(void*));
  NSView* view = (__bridge NSView*)pointer;
  if (!view || !view.window) {
    Napi::Error::New(env, "The Electron window is not ready for dragging").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  Napi::Array itemObjects = itemsValue.As<Napi::Array>();
  if (itemObjects.Length() == 0) {
    return Napi::Boolean::New(env, false);
  }

  auto callback = Napi::ThreadSafeFunction::New(
      env,
      info[1].As<Napi::Function>(),
      "Android File Transfer for macOS file promise events",
      0,
      1);
  auto state = std::make_shared<BridgeState>(std::move(callback));
  MTPPromiseCoordinator* coordinator = [[MTPPromiseCoordinator alloc] initWithState:state];
  NSMutableArray<NSDraggingItem*>* draggingItems = [NSMutableArray array];
  std::vector<std::string> registeredPromiseIds;
  NSPoint mouse = [view convertPoint:view.window.mouseLocationOutsideOfEventStream fromView:nil];

  for (uint32_t index = 0; index < itemObjects.Length(); ++index) {
    Napi::Value itemValue = itemObjects.Get(index);
    if (!itemValue.IsObject()) {
      continue;
    }
    Napi::Object itemObject = itemValue.As<Napi::Object>();
    NSString* promiseId = StringValue(itemObject, "promiseId");
    NSString* name = StringValue(itemObject, "name");
    NSString* kind = StringValue(itemObject, "kind");
    if (promiseId.length == 0 || name.length == 0) {
      continue;
    }

    NSString* fileType = UTTypeData.identifier;
    if ([kind isEqualToString:@"folder"]) {
      fileType = UTTypeDirectory.identifier;
    } else if (name.pathExtension.length > 0) {
      UTType* inferred = [UTType typeWithFilenameExtension:name.pathExtension];
      if (inferred) {
        fileType = inferred.identifier;
      }
    }

    MTPPromiseRecord* record = [[MTPPromiseRecord alloc] init];
    record.promiseId = promiseId;
    record.name = name;
    record.kind = kind;
    NSFilePromiseProvider* provider = [[NSFilePromiseProvider alloc] initWithFileType:fileType
                                                                            delegate:coordinator];
    provider.userInfo = record;
    NSDraggingItem* draggingItem = [[NSDraggingItem alloc] initWithPasteboardWriter:provider];
    NSImage* icon = [[NSWorkspace sharedWorkspace] iconForFileType:[kind isEqualToString:@"folder"]
                                                                   ? NSFileTypeForHFSTypeCode(kGenericFolderIcon)
                                                                   : name.pathExtension];
    icon.size = NSMakeSize(40, 40);
    NSRect frame = NSMakeRect(mouse.x - 16 + index * 3, mouse.y - 20 - index * 3, 40, 40);
    [draggingItem setDraggingFrame:frame contents:icon];
    [draggingItems addObject:draggingItem];
    registeredPromiseIds.push_back(promiseId.UTF8String ?: "");
  }

  if (draggingItems.count == 0) {
    state->FailAll("No valid phone files were available to drag.");
    return Napi::Boolean::New(env, false);
  }

  Napi::Value internalValue = options.Get("internalDestination");
  if (internalValue.IsObject()) {
    Napi::Object internal = internalValue.As<Napi::Object>();
    NSString* destinationPath = StringValue(internal, "path");
    Napi::Value rectValue = internal.Get("rect");
    if (destinationPath.length > 0 && rectValue.IsObject()) {
      Napi::Object rect = rectValue.As<Napi::Object>();
      double x = rect.Get("x").ToNumber().DoubleValue();
      double y = rect.Get("y").ToNumber().DoubleValue();
      double width = rect.Get("width").ToNumber().DoubleValue();
      double height = rect.Get("height").ToNumber().DoubleValue();
      NSRect bounds = view.bounds;
      MTPPromiseDropView* dropView = [[MTPPromiseDropView alloc]
          initWithFrame:NSMakeRect(x, NSHeight(bounds) - y - height, width, height)];
      dropView.coordinator = coordinator;
      dropView.destinationPath = destinationPath;
      [dropView registerForDraggedTypes:NSFilePromiseReceiver.readableDraggedTypes];
      [view addSubview:dropView positioned:NSWindowAbove relativeTo:nil];
      coordinator.dropView = dropView;
    }
  }

  NSEvent* currentEvent = NSApp.currentEvent;
  NSTimeInterval timestamp = currentEvent ? currentEvent.timestamp : NSProcessInfo.processInfo.systemUptime;
  NSPoint windowPoint = view.window.mouseLocationOutsideOfEventStream;
  NSEvent* dragEvent = [NSEvent mouseEventWithType:NSEventTypeLeftMouseDragged
                                          location:windowPoint
                                     modifierFlags:0
                                         timestamp:timestamp
                                      windowNumber:view.window.windowNumber
                                           context:nil
                                       eventNumber:0
                                        clickCount:1
                                          pressure:1.0];

  {
    std::lock_guard<std::mutex> lock(gCoordinatorMutex);
    if (!gPromiseCoordinators) {
      gPromiseCoordinators = [[NSMutableDictionary alloc] init];
    }
    for (const std::string& promiseId : registeredPromiseIds) {
      gPromiseStates[promiseId] = state;
      gPromiseCoordinators[[NSString stringWithUTF8String:promiseId.c_str()]] = coordinator;
    }
    gCoordinator = coordinator;
  }

  NSDraggingSession* session = [view beginDraggingSessionWithItems:draggingItems
                                                             event:dragEvent
                                                            source:coordinator];
  session.draggingFormation = NSDraggingFormationStack;
  return Napi::Boolean::New(env, true);
}

Napi::Value CompletePromise(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "completePromise requires a promise id").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::string promiseId = info[0].As<Napi::String>().Utf8Value();
  std::string error;
  if (info.Length() > 1 && info[1].IsString()) {
    error = info[1].As<Napi::String>().Utf8Value();
  }
  std::shared_ptr<BridgeState> state;
  {
    std::lock_guard<std::mutex> lock(gCoordinatorMutex);
    auto found = gPromiseStates.find(promiseId);
    if (found != gPromiseStates.end()) {
      state = found->second;
      gPromiseStates.erase(found);
    }
    [gPromiseCoordinators removeObjectForKey:[NSString stringWithUTF8String:promiseId.c_str()]];
    if (gPromiseCoordinators.count == 0) {
      gCoordinator = nil;
    }
  }
  return Napi::Boolean::New(env, state && state->Complete(promiseId, error));
}

Napi::Value FailAll(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string error = "The app stopped before the promised file was delivered.";
  if (info.Length() > 0 && info[0].IsString()) {
    error = info[0].As<Napi::String>().Utf8Value();
  }
  std::vector<std::shared_ptr<BridgeState>> states;
  {
    std::lock_guard<std::mutex> lock(gCoordinatorMutex);
    for (const auto& [_, state] : gPromiseStates) {
      if (std::find(states.begin(), states.end(), state) == states.end()) {
        states.push_back(state);
      }
    }
    gPromiseStates.clear();
    [gPromiseCoordinators removeAllObjects];
    gCoordinator = nil;
  }
  for (const auto& state : states) {
    state->FailAll(error);
  }
  return env.Undefined();
}

Napi::Value AtomicExchangePaths(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() != 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::TypeError::New(env, "atomicExchangePaths requires two file paths")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::string leftPath = info[0].As<Napi::String>().Utf8Value();
  std::string rightPath = info[1].As<Napi::String>().Utf8Value();
  if (renamex_np(leftPath.c_str(), rightPath.c_str(), RENAME_SWAP) != 0) {
    int errorNumber = errno;
    Napi::Error error = Napi::Error::New(
        env,
        std::string("macOS atomic rename exchange failed: ") + std::strerror(errorNumber));
    error.Value().Set("errno", Napi::Number::New(env, errorNumber));
    error.ThrowAsJavaScriptException();
    return env.Undefined();
  }

  return env.Undefined();
}

Napi::Value RequestApplicationQuit(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() != 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::TypeError::New(env, "requestApplicationQuit requires a bundle ID and bundle path")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  @autoreleasepool {
    NSString* bundleId = [NSString stringWithUTF8String:info[0].As<Napi::String>().Utf8Value().c_str()];
    NSString* bundlePath = [NSString stringWithUTF8String:info[1].As<Napi::String>().Utf8Value().c_str()];
    NSArray<NSRunningApplication*>* apps = [NSRunningApplication runningApplicationsWithBundleIdentifier:bundleId];
    NSMutableArray<NSRunningApplication*>* matches = [NSMutableArray array];
    for (NSRunningApplication* candidate in apps) {
      if (!candidate.terminated && [candidate.bundleURL.path isEqualToString:bundlePath]) {
        [matches addObject:candidate];
      }
    }
    if (matches.count == 0) return Napi::String::New(env, "not-running");
    if (matches.count != 1 || matches[0].processIdentifier == getpid()) {
      return Napi::String::New(env, "refused");
    }
    // Normal Quit delivers the app's usual termination request. It may show
    // save dialogs or refuse. Never escalate to forceTerminate or a signal.
    return Napi::String::New(env, [matches[0] terminate] ? "requested" : "refused");
  }
}

Napi::Object Initialize(Napi::Env env, Napi::Object exports) {
  exports.Set("startDrag", Napi::Function::New(env, StartDrag));
  exports.Set("completePromise", Napi::Function::New(env, CompletePromise));
  exports.Set("failAll", Napi::Function::New(env, FailAll));
  exports.Set("atomicExchangePaths", Napi::Function::New(env, AtomicExchangePaths));
  exports.Set("requestApplicationQuit", Napi::Function::New(env, RequestApplicationQuit));
  return exports;
}

NODE_API_MODULE(file_promise_drag, Initialize)
