#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <math.h>
#ifdef __APPLE__
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOKitLib.h>
#endif
#include <libusb.h>
#include <libmtp.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#ifdef __APPLE__
#ifndef kIOMainPortDefault
#define kIOMainPortDefault MACH_PORT_NULL
#endif
#endif

#define MAX_ANDROID_USB_FALLBACK_DEVICES 32
#define ROOT_PARENT_ID 0xffffffffu
#define INFERRED_STORAGE_ID 0xfffffffeu

typedef struct {
  int index;
  uint16_t vendor_id;
  uint16_t product_id;
  uint32_t bus;
  uint32_t device_address;
  char serial[128];
  char usb_session_id[32];
  char vendor[128];
  char product[256];
  int has_current_configuration;
  int current_configuration;
  int has_preferred_configuration;
  int preferred_configuration;
  int has_needs_device_access_entitlement;
  int needs_device_access_entitlement;
  int connection_mode_is_mtp;
} android_usb_fallback_device_t;

typedef struct {
  uint64_t device;
  uint64_t inode;
  uint64_t size;
  double modified_ms;
  double changed_ms;
} local_source_identity_t;

#ifdef __APPLE__
static int iokit_metadata_for_raw_device(uint16_t vendor_id,
                                         uint16_t product_id,
                                         uint32_t bus,
                                         uint32_t device_address,
                                         android_usb_fallback_device_t *out);
#endif

static void json_string(const char *value) {
  const unsigned char *p = (const unsigned char *)(value ? value : "");
  putchar('"');
  while (*p) {
    switch (*p) {
      case '\\':
        fputs("\\\\", stdout);
        break;
      case '"':
        fputs("\\\"", stdout);
        break;
      case '\b':
        fputs("\\b", stdout);
        break;
      case '\f':
        fputs("\\f", stdout);
        break;
      case '\n':
        fputs("\\n", stdout);
        break;
      case '\r':
        fputs("\\r", stdout);
        break;
      case '\t':
        fputs("\\t", stdout);
        break;
      default:
        if (*p < 0x20) {
          printf("\\u%04x", *p);
        } else {
          putchar(*p);
        }
        break;
    }
    p++;
  }
  putchar('"');
}

static const char *detect_error_state(LIBMTP_error_number_t err) {
  switch (err) {
    case LIBMTP_ERROR_NONE:
      return "connected";
    case LIBMTP_ERROR_NO_DEVICE_ATTACHED:
      return "no-device";
    case LIBMTP_ERROR_CONNECTING:
      return "connect-error";
    case LIBMTP_ERROR_MEMORY_ALLOCATION:
      return "memory-error";
    case LIBMTP_ERROR_GENERAL:
    default:
      return "error";
  }
}

static const char *detect_error_message(LIBMTP_error_number_t err) {
  switch (err) {
    case LIBMTP_ERROR_NONE:
      return "MTP raw device detected.";
    case LIBMTP_ERROR_NO_DEVICE_ATTACHED:
      return "No phone file-transfer connection was detected. Connect the phone, unlock it, and choose File transfer from the USB notification.";
    case LIBMTP_ERROR_CONNECTING:
      return "libmtp found a USB device but could not connect. The phone may be locked, in charge-only mode, or held by another app.";
    case LIBMTP_ERROR_MEMORY_ALLOCATION:
      return "libmtp reported a memory allocation error.";
    case LIBMTP_ERROR_GENERAL:
    default:
      return "libmtp reported an unknown device-detection error.";
  }
}

static const char *blocked_normal_access_message(void) {
  return "The phone is visible in File Transfer mode, but it did not answer the MTP session request. The app will try again automatically.";
}

static const char *empty_storage_root_message(void) {
  return "The phone did not return any folders for Internal storage. Keep the phone unlocked and tap Allow if Android asks; the app will keep checking automatically.";
}

static const char *first_mtp_error_text(LIBMTP_mtpdevice_t *device) {
  LIBMTP_error_t *error = LIBMTP_Get_Errorstack(device);
  if (error != NULL && error->error_text != NULL && *error->error_text != '\0') {
    return error->error_text;
  }
  return NULL;
}

static void print_raw_devices(LIBMTP_raw_device_t *rawdevices, int count) {
  printf("\"rawDevices\":[");
  for (int i = 0; i < count; i++) {
    if (i > 0) {
      putchar(',');
    }
    printf("{\"index\":%d,\"vendorId\":%u,\"productId\":%u,\"bus\":%u,\"device\":%u,\"vendor\":",
           i,
           rawdevices[i].device_entry.vendor_id,
           rawdevices[i].device_entry.product_id,
           rawdevices[i].bus_location,
           rawdevices[i].devnum);
    json_string(rawdevices[i].device_entry.vendor);
    printf(",\"product\":");
    json_string(rawdevices[i].device_entry.product);
#ifdef __APPLE__
    android_usb_fallback_device_t metadata;
    memset(&metadata, 0, sizeof(metadata));
    if (iokit_metadata_for_raw_device(rawdevices[i].device_entry.vendor_id,
                                      rawdevices[i].device_entry.product_id,
                                      rawdevices[i].bus_location,
                                      rawdevices[i].devnum,
                                      &metadata)) {
      if (metadata.serial[0] != '\0') {
        printf(",\"serial\":");
        json_string(metadata.serial);
      }
      if (metadata.usb_session_id[0] != '\0') {
        printf(",\"usbSessionId\":");
        json_string(metadata.usb_session_id);
      }
      if (metadata.has_current_configuration) {
        printf(",\"usbCurrentConfiguration\":%d", metadata.current_configuration);
      }
      if (metadata.has_preferred_configuration) {
        printf(",\"usbPreferredConfiguration\":%d", metadata.preferred_configuration);
      }
      if (metadata.has_needs_device_access_entitlement) {
        printf(",\"needsDeviceAccessEntitlement\":%s",
               metadata.needs_device_access_entitlement ? "true" : "false");
      }
    }
#endif
    printf(",\"connectionMode\":\"mtp\"");
    putchar('}');
  }
  putchar(']');
}

static const char *android_vendor_name(uint16_t vendor_id) {
  switch (vendor_id) {
    case 0x04e8:
      return "Samsung";
    case 0x18d1:
      return "Google";
    case 0x22b8:
      return "Motorola";
    case 0x12d1:
      return "Huawei";
    case 0x2717:
      return "Xiaomi";
    case 0x2a70:
      return "OnePlus";
    case 0x0bb4:
      return "HTC";
    case 0x0fce:
      return "Sony";
    case 0x1004:
      return "LG";
    default:
      return NULL;
  }
}

static int is_likely_android_usb_device(const struct libusb_device_descriptor *descriptor) {
  return android_vendor_name(descriptor->idVendor) != NULL;
}

static int is_known_mtp_usb_mode(const struct libusb_device_descriptor *descriptor) {
  return descriptor->idVendor == 0x04e8 && descriptor->idProduct == 0x6860;
}

static int string_contains_case_insensitive(const char *value, const char *needle) {
  if (value == NULL || needle == NULL || *needle == '\0') {
    return 0;
  }

  size_t needle_length = strlen(needle);
  for (const char *cursor = value; *cursor != '\0'; cursor++) {
    if (strncasecmp(cursor, needle, needle_length) == 0) {
      return 1;
    }
  }
  return 0;
}

static int fallback_device_is_mtp(uint16_t vendor_id,
                                  uint16_t product_id,
                                  const char *product,
                                  int has_current_configuration,
                                  int current_configuration,
                                  int has_preferred_configuration,
                                  int preferred_configuration) {
  if (
      has_current_configuration &&
      has_preferred_configuration &&
      preferred_configuration > 0 &&
      current_configuration != preferred_configuration) {
    return 0;
  }

  if (string_contains_case_insensitive(product, "mtp")) {
    return 1;
  }

  return vendor_id == 0x04e8 && product_id == 0x6860;
}

static void print_android_usb_fallback_devices(const android_usb_fallback_device_t *devices, int count) {
  printf("\"rawDevices\":[");
  for (int i = 0; i < count; i++) {
    if (i > 0) {
      putchar(',');
    }
    printf("{\"index\":%d,\"vendorId\":%u,\"productId\":%u,\"bus\":%u,\"device\":%u,\"vendor\":",
           devices[i].index,
           devices[i].vendor_id,
           devices[i].product_id,
           devices[i].bus,
           devices[i].device_address);
    json_string(devices[i].vendor);
    printf(",\"product\":");
    json_string(devices[i].product);
    if (devices[i].serial[0] != '\0') {
      printf(",\"serial\":");
      json_string(devices[i].serial);
    }
    if (devices[i].usb_session_id[0] != '\0') {
      printf(",\"usbSessionId\":");
      json_string(devices[i].usb_session_id);
    }
    printf(",\"connectionMode\":");
    json_string(devices[i].connection_mode_is_mtp ? "mtp" : "usb-only");
    if (devices[i].has_current_configuration) {
      printf(",\"usbCurrentConfiguration\":%d", devices[i].current_configuration);
    }
    if (devices[i].has_preferred_configuration) {
      printf(",\"usbPreferredConfiguration\":%d", devices[i].preferred_configuration);
    }
    if (devices[i].has_needs_device_access_entitlement) {
      printf(",\"needsDeviceAccessEntitlement\":%s",
             devices[i].needs_device_access_entitlement ? "true" : "false");
    }
    putchar('}');
  }
  putchar(']');
}

static int emit_android_usb_fallback_payload(const android_usb_fallback_device_t *devices, int count) {
  if (count <= 0) {
    return 0;
  }

  int mtp_count = 0;
  for (int i = 0; i < count; i++) {
    if (devices[i].connection_mode_is_mtp) {
      mtp_count++;
    }
  }

  printf("{\"ok\":false,\"state\":\"connect-error\",\"message\":");
  json_string(mtp_count > 0
                  ? blocked_normal_access_message()
                  : "Phone is connected by USB, but File transfer is not active. Unlock the phone, open the USB notification, and choose File transfer or Transferring files.");
  printf(",\"deviceCount\":%d,", count);
  print_android_usb_fallback_devices(devices, count);
  printf("}\n");
  return 1;
}

#ifdef __APPLE__
static int iokit_number_property(io_service_t service, const char *name, uint32_t *out) {
  CFStringRef key = CFStringCreateWithCString(kCFAllocatorDefault, name, kCFStringEncodingUTF8);
  if (key == NULL) {
    return 0;
  }

  CFTypeRef value = IORegistryEntryCreateCFProperty(service, key, kCFAllocatorDefault, 0);
  CFRelease(key);
  if (value == NULL) {
    return 0;
  }

  int found = 0;
  if (CFGetTypeID(value) == CFNumberGetTypeID()) {
    long long number = 0;
    if (CFNumberGetValue((CFNumberRef)value, kCFNumberLongLongType, &number) && number >= 0) {
      *out = (uint32_t)number;
      found = 1;
    }
  }

  CFRelease(value);
  return found;
}

static int iokit_number_string_property(io_service_t service,
                                        const char *name,
                                        char *buffer,
                                        size_t buffer_length) {
  if (buffer_length == 0) {
    return 0;
  }

  CFStringRef key = CFStringCreateWithCString(kCFAllocatorDefault, name, kCFStringEncodingUTF8);
  if (key == NULL) {
    return 0;
  }

  CFTypeRef value = IORegistryEntryCreateCFProperty(service, key, kCFAllocatorDefault, 0);
  CFRelease(key);
  if (value == NULL) {
    return 0;
  }

  int found = 0;
  if (CFGetTypeID(value) == CFNumberGetTypeID()) {
    long long number = 0;
    if (CFNumberGetValue((CFNumberRef)value, kCFNumberLongLongType, &number) && number >= 0) {
      snprintf(buffer, buffer_length, "%lld", number);
      found = 1;
    }
  }

  CFRelease(value);
  return found;
}

static int iokit_string_property(io_service_t service, const char *name, char *buffer, size_t buffer_length) {
  if (buffer_length == 0) {
    return 0;
  }

  CFStringRef key = CFStringCreateWithCString(kCFAllocatorDefault, name, kCFStringEncodingUTF8);
  if (key == NULL) {
    return 0;
  }

  CFTypeRef value = IORegistryEntryCreateCFProperty(service, key, kCFAllocatorDefault, 0);
  CFRelease(key);
  if (value == NULL) {
    return 0;
  }

  int found = 0;
  if (CFGetTypeID(value) == CFStringGetTypeID() &&
      CFStringGetCString((CFStringRef)value, buffer, buffer_length, kCFStringEncodingUTF8)) {
    found = 1;
  }

  CFRelease(value);
  return found;
}

static int iokit_first_string_property(io_service_t service,
                                       const char *const *names,
                                       size_t name_count,
                                       char *buffer,
                                       size_t buffer_length) {
  for (size_t i = 0; i < name_count; i++) {
    if (iokit_string_property(service, names[i], buffer, buffer_length)) {
      return 1;
    }
  }
  return 0;
}

static int iokit_metadata_for_raw_device(uint16_t vendor_id,
                                         uint16_t product_id,
                                         uint32_t bus,
                                         uint32_t device_address,
                                         android_usb_fallback_device_t *out) {
  if (out == NULL) {
    return 0;
  }

  io_iterator_t iterator = IO_OBJECT_NULL;
  io_service_t service = IO_OBJECT_NULL;
  kern_return_t result = IOServiceGetMatchingServices(
      kIOMainPortDefault,
      IOServiceMatching("IOUSBHostDevice"),
      &iterator);
  if (result != KERN_SUCCESS) {
    return 0;
  }

  int found = 0;
  while ((service = IOIteratorNext(iterator)) != IO_OBJECT_NULL) {
    uint32_t candidate_vendor_id = 0;
    uint32_t candidate_product_id = 0;
    if (!iokit_number_property(service, "idVendor", &candidate_vendor_id) ||
        !iokit_number_property(service, "idProduct", &candidate_product_id) ||
        candidate_vendor_id != vendor_id ||
        candidate_product_id != product_id) {
      IOObjectRelease(service);
      continue;
    }

    uint32_t location_id = 0;
    uint32_t candidate_bus = 0;
    if (iokit_number_property(service, "locationID", &location_id)) {
      candidate_bus = location_id / 0x1000000;
    }

    uint32_t candidate_address = 0;
    if (!iokit_number_property(service, "USB Address", &candidate_address)) {
      (void)iokit_number_property(service, "kUSBAddress", &candidate_address);
    }

    if (candidate_bus != bus || candidate_address != device_address) {
      IOObjectRelease(service);
      continue;
    }

    memset(out, 0, sizeof(*out));
    out->vendor_id = vendor_id;
    out->product_id = product_id;
    out->bus = candidate_bus;
    out->device_address = candidate_address;

    const char *serial_keys[] = {"USB Serial Number", "kUSBSerialNumberString"};
    (void)iokit_first_string_property(service, serial_keys, 2, out->serial, sizeof(out->serial));
    (void)iokit_number_string_property(service, "sessionID", out->usb_session_id, sizeof(out->usb_session_id));

    uint32_t current_configuration = 0;
    if (iokit_number_property(service, "kUSBCurrentConfiguration", &current_configuration)) {
      out->has_current_configuration = 1;
      out->current_configuration = (int)current_configuration;
    }

    uint32_t preferred_configuration = 0;
    if (iokit_number_property(service, "kUSBPreferredConfiguration", &preferred_configuration)) {
      out->has_preferred_configuration = 1;
      out->preferred_configuration = (int)preferred_configuration;
    }

    CFTypeRef entitlement_value = IORegistryEntryCreateCFProperty(
        service,
        CFSTR("NeedsDeviceAccessEntitlement"),
        kCFAllocatorDefault,
        0);
    if (entitlement_value != NULL) {
      if (CFGetTypeID(entitlement_value) == CFBooleanGetTypeID()) {
        out->has_needs_device_access_entitlement = 1;
        out->needs_device_access_entitlement = CFBooleanGetValue((CFBooleanRef)entitlement_value) ? 1 : 0;
      }
      CFRelease(entitlement_value);
    }

    found = 1;
    IOObjectRelease(service);
    break;
  }

  IOObjectRelease(iterator);
  return found;
}

static int emit_iokit_android_usb_fallback_status(void) {
  io_iterator_t iterator = IO_OBJECT_NULL;
  io_service_t service = IO_OBJECT_NULL;
  kern_return_t result = IOServiceGetMatchingServices(
      kIOMainPortDefault,
      IOServiceMatching("IOUSBHostDevice"),
      &iterator);
  if (result != KERN_SUCCESS) {
    return 0;
  }

  android_usb_fallback_device_t devices[MAX_ANDROID_USB_FALLBACK_DEVICES];
  int count = 0;
  while ((service = IOIteratorNext(iterator)) != IO_OBJECT_NULL) {
    uint32_t vendor_id = 0;
    uint32_t product_id = 0;
    if (!iokit_number_property(service, "idVendor", &vendor_id) ||
        !iokit_number_property(service, "idProduct", &product_id) ||
        android_vendor_name((uint16_t)vendor_id) == NULL) {
      IOObjectRelease(service);
      continue;
    }

    if (count >= MAX_ANDROID_USB_FALLBACK_DEVICES) {
      IOObjectRelease(service);
      continue;
    }

    android_usb_fallback_device_t *device = &devices[count];
    memset(device, 0, sizeof(*device));
    device->index = count;
    device->vendor_id = (uint16_t)vendor_id;
    device->product_id = (uint16_t)product_id;

    uint32_t location_id = 0;
    if (iokit_number_property(service, "locationID", &location_id)) {
      device->bus = location_id / 0x1000000;
    }

    uint32_t address = 0;
    if (iokit_number_property(service, "USB Address", &address) ||
        iokit_number_property(service, "kUSBAddress", &address)) {
      device->device_address = address;
    } else {
      device->device_address = (uint32_t)count + 1;
    }

    const char *vendor_keys[] = {"USB Vendor Name", "kUSBVendorString"};
    if (!iokit_first_string_property(service, vendor_keys, 2, device->vendor, sizeof(device->vendor))) {
      snprintf(device->vendor, sizeof(device->vendor), "%s", android_vendor_name((uint16_t)vendor_id));
    }

    const char *product_keys[] = {"USB Product Name", "kUSBProductString"};
    if (!iokit_first_string_property(service, product_keys, 2, device->product, sizeof(device->product))) {
      snprintf(device->product, sizeof(device->product), "%s", "Android USB device");
    }

    const char *serial_keys[] = {"USB Serial Number", "kUSBSerialNumberString"};
    (void)iokit_first_string_property(service, serial_keys, 2, device->serial, sizeof(device->serial));
    (void)iokit_number_string_property(service, "sessionID", device->usb_session_id, sizeof(device->usb_session_id));

    uint32_t current_configuration = 0;
    if (iokit_number_property(service, "kUSBCurrentConfiguration", &current_configuration)) {
      device->has_current_configuration = 1;
      device->current_configuration = (int)current_configuration;
    }

    uint32_t preferred_configuration = 0;
    if (iokit_number_property(service, "kUSBPreferredConfiguration", &preferred_configuration)) {
      device->has_preferred_configuration = 1;
      device->preferred_configuration = (int)preferred_configuration;
    }

    CFTypeRef entitlement_value = IORegistryEntryCreateCFProperty(
        service,
        CFSTR("NeedsDeviceAccessEntitlement"),
        kCFAllocatorDefault,
        0);
    if (entitlement_value != NULL) {
      if (CFGetTypeID(entitlement_value) == CFBooleanGetTypeID()) {
        device->has_needs_device_access_entitlement = 1;
        device->needs_device_access_entitlement = CFBooleanGetValue((CFBooleanRef)entitlement_value) ? 1 : 0;
      }
      CFRelease(entitlement_value);
    }

    device->connection_mode_is_mtp = fallback_device_is_mtp(
        device->vendor_id,
        device->product_id,
        device->product,
        device->has_current_configuration,
        device->current_configuration,
        device->has_preferred_configuration,
        device->preferred_configuration);

    count++;
    IOObjectRelease(service);
  }

  IOObjectRelease(iterator);
  return emit_android_usb_fallback_payload(devices, count);
}
#endif

static int count_android_usb_devices(libusb_device **devices, ssize_t device_count) {
  int count = 0;
  for (ssize_t i = 0; i < device_count; i++) {
    struct libusb_device_descriptor descriptor;
    if (libusb_get_device_descriptor(devices[i], &descriptor) != LIBUSB_SUCCESS) {
      continue;
    }
    if (is_likely_android_usb_device(&descriptor)) {
      count++;
    }
  }
  return count;
}

static int collect_libusb_android_usb_devices(libusb_device **devices,
                                              ssize_t device_count,
                                              android_usb_fallback_device_t *fallback_devices,
                                              int fallback_capacity) {
  int count = 0;
  for (ssize_t i = 0; i < device_count; i++) {
    struct libusb_device_descriptor descriptor;
    if (libusb_get_device_descriptor(devices[i], &descriptor) != LIBUSB_SUCCESS) {
      continue;
    }
    if (!is_likely_android_usb_device(&descriptor)) {
      continue;
    }

    if (count >= fallback_capacity) {
      continue;
    }

    android_usb_fallback_device_t *fallback_device = &fallback_devices[count];
    memset(fallback_device, 0, sizeof(*fallback_device));
    fallback_device->index = count;
    fallback_device->vendor_id = descriptor.idVendor;
    fallback_device->product_id = descriptor.idProduct;
    fallback_device->bus = (uint32_t)libusb_get_bus_number(devices[i]);
    fallback_device->device_address = (uint32_t)libusb_get_device_address(devices[i]);
    snprintf(fallback_device->vendor, sizeof(fallback_device->vendor), "%s", android_vendor_name(descriptor.idVendor));
    snprintf(
        fallback_device->product,
        sizeof(fallback_device->product),
        "%s",
        is_known_mtp_usb_mode(&descriptor)
            ? "USB connected; MTP/File Transfer is visible"
            : "USB connected; File transfer is not active");
    fallback_device->connection_mode_is_mtp = is_known_mtp_usb_mode(&descriptor);
    count++;
  }
  return count;
}

static int emit_libusb_android_usb_fallback_status(void) {
  libusb_context *context = NULL;
  libusb_device **devices = NULL;
  ssize_t device_count = 0;
  int android_count = 0;
  android_usb_fallback_device_t fallback_devices[MAX_ANDROID_USB_FALLBACK_DEVICES];

  if (libusb_init(&context) != LIBUSB_SUCCESS) {
    return 0;
  }

  device_count = libusb_get_device_list(context, &devices);
  if (device_count < 0) {
    libusb_exit(context);
    return 0;
  }

  android_count = count_android_usb_devices(devices, device_count);
  if (android_count > 0) {
    android_count = collect_libusb_android_usb_devices(
        devices,
        device_count,
        fallback_devices,
        MAX_ANDROID_USB_FALLBACK_DEVICES);
    emit_android_usb_fallback_payload(fallback_devices, android_count);
  }

  libusb_free_device_list(devices, 1);
  libusb_exit(context);
  return android_count > 0;
}

static int emit_android_usb_fallback_status(void) {
#ifdef __APPLE__
  if (emit_iokit_android_usb_fallback_status()) {
    return 1;
  }
#endif
  return emit_libusb_android_usb_fallback_status();
}

static int command_status(void) {
  LIBMTP_raw_device_t *rawdevices = NULL;
  int numrawdevices = 0;
  LIBMTP_error_number_t err;

  LIBMTP_Init();
  err = LIBMTP_Detect_Raw_Devices(&rawdevices, &numrawdevices);

  if ((err == LIBMTP_ERROR_NO_DEVICE_ATTACHED || (err == LIBMTP_ERROR_NONE && numrawdevices == 0)) &&
      emit_android_usb_fallback_status()) {
    if (rawdevices != NULL) {
      LIBMTP_FreeMemory(rawdevices);
    }
    return 0;
  }

  printf("{\"ok\":true,\"state\":");
  json_string(detect_error_state(err));
  printf(",\"message\":");
  json_string(detect_error_message(err));
  printf(",\"deviceCount\":%d,", err == LIBMTP_ERROR_NONE ? numrawdevices : 0);
  print_raw_devices(rawdevices, err == LIBMTP_ERROR_NONE ? numrawdevices : 0);
  printf("}\n");

  if (rawdevices != NULL) {
    LIBMTP_FreeMemory(rawdevices);
  }
  return err == LIBMTP_ERROR_MEMORY_ALLOCATION ? 1 : 0;
}

static void print_object_with_storage_fallback(LIBMTP_file_t *file, int *first_object, uint32_t fallback_storage_id) {
  if (!*first_object) {
    putchar(',');
  }
  *first_object = 0;

  const char *type_description = LIBMTP_Get_Filetype_Description(file->filetype);
  int is_folder = file->filetype == LIBMTP_FILETYPE_FOLDER;

  uint32_t storage_id = file->storage_id != 0 ? file->storage_id : fallback_storage_id;

  printf("{\"id\":%u,\"parentId\":%u,\"storageId\":%u,\"name\":",
         file->item_id,
         file->parent_id,
         storage_id);
  json_string(file->filename);
  printf(",\"kind\":");
  json_string(is_folder ? "folder" : "file");
  printf(",\"size\":%llu,\"modified\":%lld,\"filetype\":",
         is_folder ? 0ULL : (long long unsigned int)file->filesize,
         (long long)file->modificationdate);
  json_string(type_description);
  putchar('}');
}

static void print_object(LIBMTP_file_t *file, int *first_object) {
  print_object_with_storage_fallback(file, first_object, 0);
}

static void destroy_file_list(LIBMTP_file_t *files) {
  LIBMTP_file_t *file = files;
  while (file != NULL) {
    LIBMTP_file_t *current = file;
    file = file->next;
    LIBMTP_destroy_file_t(current);
  }
}

static void print_storage(LIBMTP_devicestorage_t *storage, int *first_storage) {
  if (!*first_storage) {
    putchar(',');
  }
  *first_storage = 0;
  printf("{\"id\":%u,\"description\":", storage->id);
  json_string(storage->StorageDescription);
  printf(",\"volumeIdentifier\":");
  json_string(storage->VolumeIdentifier);
  printf(",\"maxCapacity\":%llu,\"freeSpace\":%llu}",
         (long long unsigned int)storage->MaxCapacity,
         (long long unsigned int)storage->FreeSpaceInBytes);
}

static void print_inferred_storage_if_needed(LIBMTP_raw_device_t *rawdevice, int *first_storage) {
  if (!*first_storage || rawdevice == NULL) {
    return;
  }

  if (rawdevice->device_entry.vendor_id != 0x04e8) {
    return;
  }

  *first_storage = 0;
  printf("{\"id\":%u,\"description\":\"Phone storage\",\"volumeIdentifier\":\"inferred-storage\",\"maxCapacity\":0,\"freeSpace\":0,\"inferred\":true}",
         INFERRED_STORAGE_ID);
}

static int is_inferred_samsung_storage(LIBMTP_raw_device_t *rawdevice, uint32_t storage_id) {
  return rawdevice != NULL &&
         rawdevice->device_entry.vendor_id == 0x04e8 &&
         storage_id == INFERRED_STORAGE_ID;
}

static int file_belongs_to_storage_or_inferred(LIBMTP_file_t *file,
                                               uint32_t storage_id,
                                               int inferred_storage) {
  return inferred_storage || file->storage_id == storage_id;
}

static int file_matches_parent(LIBMTP_file_t *file, uint32_t parent_id) {
  if (file->parent_id == parent_id) {
    return 1;
  }
  return parent_id == ROOT_PARENT_ID && file->parent_id == 0;
}

static void print_filelisting_fallback_objects(LIBMTP_file_t *files,
                                               LIBMTP_raw_device_t *rawdevice,
                                               uint32_t storage_id,
                                               uint32_t parent_id,
                                               int *first_object) {
  int inferred_storage = is_inferred_samsung_storage(rawdevice, storage_id);

  for (LIBMTP_file_t *file = files; file != NULL; file = file->next) {
    if (!file_belongs_to_storage_or_inferred(file, storage_id, inferred_storage)) {
      continue;
    }
    if (!file_matches_parent(file, parent_id)) {
      continue;
    }
    print_object_with_storage_fallback(file, first_object, storage_id);
  }

}

static int prepare_device_storage(LIBMTP_mtpdevice_t *device, LIBMTP_raw_device_t *rawdevice) {
  int result = LIBMTP_Get_Storage(device, LIBMTP_STORAGE_SORTBY_NOTSORTED);
  if (device->storage != NULL) {
    if (result != 0) {
      LIBMTP_Clear_Errorstack(device);
    }
    return 1;
  }
  if (rawdevice != NULL && rawdevice->device_entry.vendor_id == 0x04e8) {
    LIBMTP_Clear_Errorstack(device);
    return 2;
  }
  return 0;
}

static char *next_token(char **cursor) {
  char *start = *cursor;
  while (*start == ' ' || *start == '\t') {
    start++;
  }

  if (*start == '\0') {
    *cursor = start;
    return NULL;
  }

  char *end = start;
  while (*end != '\0' && *end != ' ' && *end != '\t' && *end != '\n' && *end != '\r') {
    end++;
  }

  if (*end != '\0') {
    *end = '\0';
    end++;
  }

  *cursor = end;
  return start;
}

static char *rest_token(char **cursor) {
  char *start = *cursor;
  while (*start == ' ' || *start == '\t') {
    start++;
  }

  size_t length = strlen(start);
  while (length > 0 && (start[length - 1] == '\n' || start[length - 1] == '\r')) {
    start[length - 1] = '\0';
    length--;
  }

  *cursor = start + length;
  return start;
}

static int parse_u32(const char *value, uint32_t *out) {
  if (value == NULL || *value == '\0') {
    return 0;
  }

  char *endptr = NULL;
  errno = 0;
  unsigned long parsed = strtoul(value, &endptr, 10);
  if (errno != 0 || endptr == value || *endptr != '\0' || parsed > UINT32_MAX) {
    return 0;
  }

  *out = (uint32_t)parsed;
  return 1;
}

static int parse_u64(const char *value, uint64_t *out) {
  if (value == NULL || *value == '\0') {
    return 0;
  }

  char *endptr = NULL;
  errno = 0;
  unsigned long long parsed = strtoull(value, &endptr, 10);
  if (errno != 0 || endptr == value || *endptr != '\0') {
    return 0;
  }

  *out = (uint64_t)parsed;
  return (unsigned long long)*out == parsed;
}

static int parse_finite_double(const char *value, double *out) {
  if (value == NULL || *value == '\0') {
    return 0;
  }

  char *endptr = NULL;
  errno = 0;
  double parsed = strtod(value, &endptr);
  if (errno != 0 || endptr == value || *endptr != '\0' || !isfinite(parsed)) {
    return 0;
  }
  *out = parsed;
  return 1;
}

static int parse_optional_u64(const char *value, uint64_t *out, int *available) {
  if (value != NULL && strcmp(value, "-") == 0) {
    *out = 0;
    *available = 0;
    return 1;
  }
  if (!parse_u64(value, out)) {
    return 0;
  }
  *available = 1;
  return 1;
}

static int hex_value(char value) {
  if (value >= '0' && value <= '9') {
    return value - '0';
  }
  if (value >= 'a' && value <= 'f') {
    return value - 'a' + 10;
  }
  if (value >= 'A' && value <= 'F') {
    return value - 'A' + 10;
  }
  return -1;
}

static int valid_utf8(const unsigned char *value, size_t length) {
  size_t index = 0;
  while (index < length) {
    unsigned char first = value[index++];
    if (first <= 0x7f) {
      continue;
    }

    size_t continuation_count = 0;
    unsigned char minimum_second = 0x80;
    unsigned char maximum_second = 0xbf;
    if (first >= 0xc2 && first <= 0xdf) {
      continuation_count = 1;
    } else if (first >= 0xe0 && first <= 0xef) {
      continuation_count = 2;
      if (first == 0xe0) {
        minimum_second = 0xa0;
      } else if (first == 0xed) {
        maximum_second = 0x9f;
      }
    } else if (first >= 0xf0 && first <= 0xf4) {
      continuation_count = 3;
      if (first == 0xf0) {
        minimum_second = 0x90;
      } else if (first == 0xf4) {
        maximum_second = 0x8f;
      }
    } else {
      return 0;
    }

    if (index + continuation_count > length ||
        value[index] < minimum_second ||
        value[index] > maximum_second) {
      return 0;
    }
    index++;
    for (size_t offset = 1; offset < continuation_count; offset++, index++) {
      if (value[index] < 0x80 || value[index] > 0xbf) {
        return 0;
      }
    }
  }
  return 1;
}

static int valid_phone_item_name(const char *name, size_t length) {
  if (name == NULL || length == 0 || length > 255 ||
      (length == 1 && name[0] == '.') ||
      (length == 2 && name[0] == '.' && name[1] == '.')) {
    return 0;
  }

  for (size_t index = 0; index < length; index++) {
    unsigned char value = (unsigned char)name[index];
    if (value == 0 || value < 0x20 || value == 0x7f ||
        value == '/' || value == '\\' || value == ':' || value == '*' ||
        value == '?' || value == '"' || value == '<' || value == '>' || value == '|') {
      return 0;
    }
  }
  return valid_utf8((const unsigned char *)name, length);
}

static int decode_phone_item_name(const char *encoded, int validate_for_write, char **out) {
  if (encoded == NULL || out == NULL) {
    return 0;
  }
  size_t encoded_length = strlen(encoded);
  if (encoded_length == 0 || encoded_length > 510 || encoded_length % 2 != 0) {
    return 0;
  }

  size_t decoded_length = encoded_length / 2;
  char *decoded = malloc(decoded_length + 1);
  if (decoded == NULL) {
    return 0;
  }
  for (size_t index = 0; index < decoded_length; index++) {
    int high = hex_value(encoded[index * 2]);
    int low = hex_value(encoded[index * 2 + 1]);
    if (high < 0 || low < 0) {
      free(decoded);
      return 0;
    }
    decoded[index] = (char)((high << 4) | low);
  }
  decoded[decoded_length] = '\0';
  if ((validate_for_write && !valid_phone_item_name(decoded, decoded_length)) ||
      (!validate_for_write &&
       (decoded_length == 0 || decoded_length > 255 ||
        memchr(decoded, '\0', decoded_length) != NULL ||
        !valid_utf8((const unsigned char *)decoded, decoded_length)))) {
    free(decoded);
    return 0;
  }
  *out = decoded;
  return 1;
}

static int parse_nonnegative_int(const char *value, int *out) {
  if (value == NULL || *value == '\0') {
    return 0;
  }
  char *endptr = NULL;
  errno = 0;
  long parsed = strtol(value, &endptr, 10);
  if (errno != 0 || endptr == value || *endptr != '\0' || parsed < 0 || parsed > INT_MAX) {
    return 0;
  }
  *out = (int)parsed;
  return 1;
}

static void print_session_error(const char *request_id, const char *message) {
  printf("{\"type\":\"response\",\"requestId\":");
  json_string(request_id);
  printf(",\"ok\":false,\"state\":\"error\",\"message\":");
  json_string(message);
  printf("}\n");
  fflush(stdout);
}

static void print_inventory_device(int device_index,
                                   LIBMTP_raw_device_t *rawdevice,
                                   LIBMTP_mtpdevice_t *device,
                                   int storage_mode) {
  char *friendlyname = LIBMTP_Get_Friendlyname(device);
  char *serial = LIBMTP_Get_Serialnumber(device);

  printf("{\"index\":%d,\"name\":", device_index);
  json_string(friendlyname);
  printf(",\"serial\":");
  json_string(serial);
  printf(",\"vendorId\":%u,\"productId\":%u,\"vendor\":",
         rawdevice->device_entry.vendor_id,
         rawdevice->device_entry.product_id);
  json_string(rawdevice->device_entry.vendor);
  printf(",\"product\":");
  json_string(rawdevice->device_entry.product);
  printf(",\"storages\":[");

  int first_storage = 1;
  if (storage_mode == 1) {
    for (LIBMTP_devicestorage_t *storage = device->storage; storage != NULL; storage = storage->next) {
      print_storage(storage, &first_storage);
    }
  } else if (storage_mode == 2) {
    print_inferred_storage_if_needed(rawdevice, &first_storage);
  }

  printf("],\"objects\":[]}");

  if (friendlyname != NULL) {
    LIBMTP_FreeMemory(friendlyname);
  }
  if (serial != NULL) {
    LIBMTP_FreeMemory(serial);
  }
}

static int command_inventory(void) {
  LIBMTP_raw_device_t *rawdevices = NULL;
  LIBMTP_mtpdevice_t **opened_devices = NULL;
  int *storage_modes = NULL;
  int numrawdevices = 0;
  int opened_count = 0;
  LIBMTP_error_number_t err;
  int first_device = 1;

  LIBMTP_Init();
  err = LIBMTP_Detect_Raw_Devices(&rawdevices, &numrawdevices);
  if (err != LIBMTP_ERROR_NONE) {
    printf("{\"ok\":false,\"state\":");
    json_string(detect_error_state(err));
    printf(",\"message\":");
    json_string(detect_error_message(err));
    printf(",\"devices\":[]}\n");
    if (rawdevices != NULL) {
      LIBMTP_FreeMemory(rawdevices);
    }
    return err == LIBMTP_ERROR_NO_DEVICE_ATTACHED ? 0 : 1;
  }

  opened_devices = calloc((size_t)numrawdevices, sizeof(LIBMTP_mtpdevice_t *));
  storage_modes = calloc((size_t)numrawdevices, sizeof(int));
  if (opened_devices == NULL || storage_modes == NULL) {
    printf("{\"ok\":false,\"state\":\"memory-error\",\"message\":\"Unable to allocate memory while opening MTP devices.\",\"devices\":[]}\n");
    LIBMTP_FreeMemory(rawdevices);
    return 1;
  }

  for (int i = 0; i < numrawdevices; i++) {
    opened_devices[i] = LIBMTP_Open_Raw_Device_Uncached(&rawdevices[i]);
    if (opened_devices[i] != NULL) {
      storage_modes[i] = prepare_device_storage(opened_devices[i], &rawdevices[i]);
      if (storage_modes[i] == 0) {
        LIBMTP_Release_Device(opened_devices[i]);
        opened_devices[i] = NULL;
      } else {
        opened_count++;
      }
    }
  }

  if (opened_count == 0) {
    printf("{\"ok\":false,\"state\":\"connect-error\",\"message\":");
    json_string("The phone file session opened, but the device did not return usable storage information.");
    printf(",\"devices\":[]}\n");
    free(opened_devices);
    free(storage_modes);
    LIBMTP_FreeMemory(rawdevices);
    return 1;
  }

  printf("{\"ok\":true,\"state\":\"connected\",\"message\":\"Inventory scan completed.\",\"devices\":[");

  for (int i = 0; i < numrawdevices; i++) {
    LIBMTP_mtpdevice_t *device = opened_devices[i];
    if (device == NULL) {
      continue;
    }

    if (!first_device) {
      putchar(',');
    }
    first_device = 0;

    print_inventory_device(i, &rawdevices[i], device, storage_modes[i]);
    LIBMTP_Release_Device(device);
  }

  printf("]}\n");
  free(opened_devices);
  free(storage_modes);
  LIBMTP_FreeMemory(rawdevices);
  return 0;
}

static int command_reset(void) {
  LIBMTP_raw_device_t *rawdevices = NULL;
  int numrawdevices = 0;
  LIBMTP_error_number_t mtp_err;
  libusb_context *context = NULL;
  libusb_device **devices = NULL;
  libusb_device_handle *handle = NULL;
  ssize_t device_count = 0;
  int open_result = LIBUSB_ERROR_NOT_FOUND;
  int reset_result = LIBUSB_ERROR_NOT_FOUND;

  LIBMTP_Init();
  mtp_err = LIBMTP_Detect_Raw_Devices(&rawdevices, &numrawdevices);
  if (mtp_err != LIBMTP_ERROR_NONE || numrawdevices == 0) {
    printf("{\"ok\":false,\"state\":");
    json_string(detect_error_state(mtp_err));
    printf(",\"message\":");
    json_string(detect_error_message(mtp_err));
    printf("}\n");
    if (rawdevices != NULL) {
      LIBMTP_FreeMemory(rawdevices);
    }
    return mtp_err == LIBMTP_ERROR_NO_DEVICE_ATTACHED ? 0 : 1;
  }

  LIBMTP_raw_device_t *target = &rawdevices[0];
  int init_result = libusb_init(&context);
  if (init_result != LIBUSB_SUCCESS) {
    char message[256];
    snprintf(message, sizeof(message), "Unable to start USB reset: %s.", libusb_error_name(init_result));
    printf("{\"ok\":false,\"state\":\"connect-error\",\"message\":");
    json_string(message);
    printf("}\n");
    LIBMTP_FreeMemory(rawdevices);
    return 1;
  }

  device_count = libusb_get_device_list(context, &devices);
  if (device_count < 0) {
    char message[256];
    snprintf(message, sizeof(message), "Unable to inspect USB devices for reset: %s.", libusb_error_name((int)device_count));
    printf("{\"ok\":false,\"state\":\"connect-error\",\"message\":");
    json_string(message);
    printf("}\n");
    libusb_exit(context);
    LIBMTP_FreeMemory(rawdevices);
    return 1;
  }

  for (ssize_t i = 0; i < device_count; i++) {
    struct libusb_device_descriptor descriptor;
    int descriptor_result = libusb_get_device_descriptor(devices[i], &descriptor);
    if (descriptor_result != LIBUSB_SUCCESS) {
      continue;
    }

    if (descriptor.idVendor != target->device_entry.vendor_id ||
        descriptor.idProduct != target->device_entry.product_id) {
      continue;
    }

    if (libusb_get_bus_number(devices[i]) != target->bus_location ||
        libusb_get_device_address(devices[i]) != target->devnum) {
      continue;
    }

    open_result = libusb_open(devices[i], &handle);
    if (open_result == LIBUSB_SUCCESS && handle != NULL) {
      reset_result = libusb_reset_device(handle);
      libusb_close(handle);
    }
    break;
  }

  libusb_free_device_list(devices, 1);
  libusb_exit(context);

  if (open_result != LIBUSB_SUCCESS) {
    char message[384];
    snprintf(message, sizeof(message), "macOS would not open the phone for USB reset: %s. Unplug the phone, plug it back in, unlock it, then choose File transfer.", libusb_error_name(open_result));
    printf("{\"ok\":false,\"state\":\"connect-error\",\"message\":");
    json_string(message);
    printf("}\n");
    LIBMTP_FreeMemory(rawdevices);
    return 1;
  }

  if (reset_result != LIBUSB_SUCCESS) {
    char message[384];
    snprintf(message, sizeof(message), "USB reset did not complete: %s. Unplug the phone, plug it back in, unlock it, then choose File transfer.", libusb_error_name(reset_result));
    printf("{\"ok\":false,\"state\":\"connect-error\",\"message\":");
    json_string(message);
    printf("}\n");
    LIBMTP_FreeMemory(rawdevices);
    return 1;
  }

  printf("{\"ok\":true,\"state\":\"checking\",\"message\":\"USB reset requested. Keep the phone unlocked and choose File transfer if Android asks.\"}\n");
  LIBMTP_FreeMemory(rawdevices);
  return 0;
}

static int command_list(int argc, char **argv) {
  if (argc < 5) {
    fprintf(stderr, "usage: mtp-json list <device-index> <storage-id> <parent-id>\n");
    return 2;
  }

  int device_index = 0;
  uint32_t storage_id = 0;
  uint32_t parent_id = 0;
  if (!parse_nonnegative_int(argv[2], &device_index)) {
    fprintf(stderr, "invalid device index: %s\n", argv[2]);
    return 2;
  }
  if (!parse_u32(argv[3], &storage_id) || storage_id == 0) {
    fprintf(stderr, "invalid storage id: %s\n", argv[3]);
    return 2;
  }

  if (!parse_u32(argv[4], &parent_id)) {
    fprintf(stderr, "invalid parent id: %s\n", argv[4]);
    return 2;
  }

  LIBMTP_raw_device_t *rawdevices = NULL;
  int numrawdevices = 0;
  LIBMTP_error_number_t err;

  LIBMTP_Init();
  err = LIBMTP_Detect_Raw_Devices(&rawdevices, &numrawdevices);
  if (err != LIBMTP_ERROR_NONE) {
    printf("{\"ok\":false,\"state\":");
    json_string(detect_error_state(err));
    printf(",\"message\":");
    json_string(detect_error_message(err));
    printf(",\"deviceIndex\":%d,\"storageId\":%u,\"parentId\":%u,\"objects\":[]}\n",
           device_index,
           storage_id,
           parent_id);
    if (rawdevices != NULL) {
      LIBMTP_FreeMemory(rawdevices);
    }
    return err == LIBMTP_ERROR_NO_DEVICE_ATTACHED ? 0 : 1;
  }

  if (device_index < 0 || device_index >= numrawdevices) {
    printf("{\"ok\":false,\"state\":\"error\",\"message\":\"Invalid MTP device index.\",\"deviceIndex\":%d,\"storageId\":%u,\"parentId\":%u,\"objects\":[]}\n",
           device_index,
           storage_id,
           parent_id);
    LIBMTP_FreeMemory(rawdevices);
    return 2;
  }

  LIBMTP_mtpdevice_t *device = LIBMTP_Open_Raw_Device_Uncached(&rawdevices[device_index]);
  if (device == NULL) {
    printf("{\"ok\":false,\"state\":\"connect-error\",\"message\":");
    json_string(blocked_normal_access_message());
    printf(",\"deviceIndex\":%d,\"storageId\":%u,\"parentId\":%u,\"objects\":[]}\n",
           device_index,
           storage_id,
           parent_id);
    LIBMTP_FreeMemory(rawdevices);
    return 1;
  }

  LIBMTP_file_t *files = LIBMTP_Get_Files_And_Folders(device, storage_id, parent_id);
  const char *list_error = files == NULL ? first_mtp_error_text(device) : NULL;
  if (files == NULL && is_inferred_samsung_storage(&rawdevices[device_index], storage_id)) {
    LIBMTP_Clear_Errorstack(device);
    LIBMTP_file_t *fallback_files = LIBMTP_Get_Filelisting_With_Callback(device, NULL, NULL);
    if (fallback_files == NULL) {
      const char *fallback_error = first_mtp_error_text(device);
      printf("{\"ok\":false,\"state\":\"error\",\"message\":");
      json_string(fallback_error != NULL
                      ? fallback_error
                      : "The phone did not return its file index for the Samsung storage fallback.");
      printf(",\"deviceIndex\":%d,\"storageId\":%u,\"parentId\":%u,\"objects\":[]}\n",
             device_index,
             storage_id,
             parent_id);
      LIBMTP_Clear_Errorstack(device);
      LIBMTP_Release_Device(device);
      LIBMTP_FreeMemory(rawdevices);
      return 1;
    }

    printf("{\"ok\":true,\"state\":\"connected\",\"message\":\"Folder listed with Samsung storage fallback.\",\"deviceIndex\":%d,\"storageId\":%u,\"parentId\":%u,\"objects\":[",
           device_index,
           storage_id,
           parent_id);
    int first_object = 1;
    print_filelisting_fallback_objects(
        fallback_files,
        &rawdevices[device_index],
        storage_id,
        parent_id,
        &first_object);
    destroy_file_list(fallback_files);
    LIBMTP_Clear_Errorstack(device);
    printf("]}\n");
    LIBMTP_Release_Device(device);
    LIBMTP_FreeMemory(rawdevices);
    return 0;
  }
  if (files == NULL && (list_error != NULL || parent_id == ROOT_PARENT_ID)) {
    printf("{\"ok\":false,\"state\":\"error\",\"message\":");
    json_string(list_error != NULL ? list_error : empty_storage_root_message());
    printf(",\"deviceIndex\":%d,\"storageId\":%u,\"parentId\":%u,\"objects\":[]}\n",
           device_index,
           storage_id,
           parent_id);
    LIBMTP_Clear_Errorstack(device);
    LIBMTP_Release_Device(device);
    LIBMTP_FreeMemory(rawdevices);
    return 1;
  }

  printf("{\"ok\":true,\"state\":\"connected\",\"message\":\"Folder listed.\",\"deviceIndex\":%d,\"storageId\":%u,\"parentId\":%u,\"objects\":[",
         device_index,
         storage_id,
         parent_id);

  int first_object = 1;
  LIBMTP_file_t *file = files;
  while (file != NULL) {
    LIBMTP_file_t *current = file;
    file = file->next;
    print_object(current, &first_object);
    LIBMTP_destroy_file_t(current);
  }

  printf("]}\n");
  LIBMTP_Release_Device(device);
  LIBMTP_FreeMemory(rawdevices);
  return 0;
}

static const uint64_t progress_emit_interval = 1024 * 1024;
static uint64_t last_progress_sent = 0;
static uint64_t session_last_progress_sent = 0;
static uint64_t session_list_last_progress_sent = 0;
static int session_list_last_percent = -1;
static const char *session_transfer_request_id = "";
static const char *session_transfer_type = "download";
static const char *session_list_request_id = "";

static int should_emit_progress(uint64_t const sent, uint64_t const total, uint64_t *last_sent) {
  if (sent == 0 || sent >= total || sent - *last_sent >= progress_emit_interval) {
    *last_sent = sent;
    return 1;
  }
  return 0;
}

static int progress_callback(uint64_t const sent, uint64_t const total, void const *const data) {
  (void)data;
  if (!should_emit_progress(sent, total, &last_progress_sent)) {
    return 0;
  }
  printf("{\"event\":\"progress\",\"sent\":%llu,\"total\":%llu,\"time\":%lld}\n",
         (long long unsigned int)sent,
         (long long unsigned int)total,
         (long long)time(NULL));
  fflush(stdout);
  return 0;
}

static int session_progress_callback(uint64_t const sent, uint64_t const total, void const *const data) {
  (void)data;
  if (!should_emit_progress(sent, total, &session_last_progress_sent)) {
    return 0;
  }
  printf("{\"type\":");
  json_string(session_transfer_type);
  printf(",\"requestId\":");
  json_string(session_transfer_request_id);
  printf(",\"event\":\"progress\",\"sent\":%llu,\"total\":%llu,\"time\":%lld}\n",
         (long long unsigned int)sent,
         (long long unsigned int)total,
         (long long)time(NULL));
  fflush(stdout);
  return 0;
}

static int session_list_progress_callback(uint64_t const sent,
                                          uint64_t const total,
                                          void const *const data) {
  (void)data;
  if (total > 0) {
    int percent = (int)((sent * 100) / total);
    if (percent == session_list_last_percent && sent < total) {
      return 0;
    }
    session_list_last_percent = percent;
  } else {
    if (sent != 0 && sent - session_list_last_progress_sent < 100) {
      return 0;
    }
  }
  session_list_last_progress_sent = sent;
  printf("{\"type\":\"list\",\"requestId\":");
  json_string(session_list_request_id);
  printf(",\"event\":\"progress\",\"sent\":%llu,\"total\":%llu,\"time\":%lld}\n",
         (long long unsigned int)sent,
         (long long unsigned int)total,
         (long long)time(NULL));
  fflush(stdout);
  return 0;
}

static LIBMTP_file_t *ensure_session_fallback_files(LIBMTP_mtpdevice_t *device,
                                                    const char *request_id,
                                                    LIBMTP_file_t **fallback_files,
                                                    int *fallback_attempted) {
  if (*fallback_attempted && *fallback_files != NULL) {
    return *fallback_files;
  }

  *fallback_attempted = 1;
  LIBMTP_Clear_Errorstack(device);
  session_list_request_id = request_id;
  session_list_last_progress_sent = 0;
  session_list_last_percent = -1;
  *fallback_files = LIBMTP_Get_Filelisting_With_Callback(
      device,
      session_list_progress_callback,
      NULL);
  session_list_request_id = "";
  if (*fallback_files == NULL) {
    *fallback_attempted = 0;
  }
  return *fallback_files;
}

static uint32_t inferred_storage_id_for_write(LIBMTP_file_t *files) {
  uint32_t resolved_storage_id = 0;
  for (LIBMTP_file_t *file = files; file != NULL; file = file->next) {
    if (file->storage_id == 0 || file->storage_id == INFERRED_STORAGE_ID) {
      continue;
    }
    if (resolved_storage_id == 0) {
      resolved_storage_id = file->storage_id;
      continue;
    }
    if (resolved_storage_id != file->storage_id) {
      return 0;
    }
  }
  return resolved_storage_id;
}

static const char *path_basename(const char *path) {
  if (path == NULL || *path == '\0') {
    return "";
  }

  const char *slash = strrchr(path, '/');
  return slash == NULL ? path : slash + 1;
}

static int name_has_extension(const char *name, const char *extension) {
  size_t name_length = strlen(name);
  size_t extension_length = strlen(extension);
  if (name_length <= extension_length) {
    return 0;
  }
  return strcasecmp(name + name_length - extension_length, extension) == 0;
}

static LIBMTP_filetype_t filetype_for_name(const char *name) {
  if (name_has_extension(name, ".jpg") || name_has_extension(name, ".jpeg")) {
    return LIBMTP_FILETYPE_JPEG;
  }
  if (name_has_extension(name, ".png")) {
    return LIBMTP_FILETYPE_PNG;
  }
  if (name_has_extension(name, ".gif")) {
    return LIBMTP_FILETYPE_GIF;
  }
  if (name_has_extension(name, ".bmp")) {
    return LIBMTP_FILETYPE_BMP;
  }
  if (name_has_extension(name, ".tif") || name_has_extension(name, ".tiff")) {
    return LIBMTP_FILETYPE_TIFF;
  }
  if (name_has_extension(name, ".mp3")) {
    return LIBMTP_FILETYPE_MP3;
  }
  if (name_has_extension(name, ".m4a")) {
    return LIBMTP_FILETYPE_M4A;
  }
  if (name_has_extension(name, ".aac")) {
    return LIBMTP_FILETYPE_AAC;
  }
  if (name_has_extension(name, ".flac")) {
    return LIBMTP_FILETYPE_FLAC;
  }
  if (name_has_extension(name, ".wav")) {
    return LIBMTP_FILETYPE_WAV;
  }
  if (name_has_extension(name, ".ogg")) {
    return LIBMTP_FILETYPE_OGG;
  }
  if (name_has_extension(name, ".mp4") || name_has_extension(name, ".m4v")) {
    return LIBMTP_FILETYPE_MP4;
  }
  if (name_has_extension(name, ".mov")) {
    return LIBMTP_FILETYPE_QT;
  }
  if (name_has_extension(name, ".avi")) {
    return LIBMTP_FILETYPE_AVI;
  }
  if (name_has_extension(name, ".wmv")) {
    return LIBMTP_FILETYPE_WMV;
  }
  if (name_has_extension(name, ".txt")) {
    return LIBMTP_FILETYPE_TEXT;
  }
  if (name_has_extension(name, ".html") || name_has_extension(name, ".htm")) {
    return LIBMTP_FILETYPE_HTML;
  }
  if (name_has_extension(name, ".xml")) {
    return LIBMTP_FILETYPE_XML;
  }
  if (name_has_extension(name, ".doc") || name_has_extension(name, ".docx")) {
    return LIBMTP_FILETYPE_DOC;
  }
  if (name_has_extension(name, ".xls") || name_has_extension(name, ".xlsx")) {
    return LIBMTP_FILETYPE_XLS;
  }
  if (name_has_extension(name, ".ppt") || name_has_extension(name, ".pptx")) {
    return LIBMTP_FILETYPE_PPT;
  }
  return LIBMTP_FILETYPE_UNKNOWN;
}

static int phone_file_conflict_status(LIBMTP_mtpdevice_t *device,
                                      const char *filename,
                                      uint32_t storage_id,
                                      uint32_t parent_id) {
  LIBMTP_file_t *files = LIBMTP_Get_Files_And_Folders(device, storage_id, parent_id);
  LIBMTP_file_t *file = files;
  int status = 0;

  while (file != NULL) {
    LIBMTP_file_t *current = file;
    file = file->next;

    if (status == 0 && current->filename != NULL && strcmp(current->filename, filename) == 0) {
      status = 2;
    }

    LIBMTP_destroy_file_t(current);
  }

  return status;
}

static double source_stat_modified_ms(const struct stat *source_stat) {
#ifdef __APPLE__
  return (double)source_stat->st_mtimespec.tv_sec * 1000.0 +
         (double)source_stat->st_mtimespec.tv_nsec / 1000000.0;
#else
  return (double)source_stat->st_mtim.tv_sec * 1000.0 +
         (double)source_stat->st_mtim.tv_nsec / 1000000.0;
#endif
}

static double source_stat_changed_ms(const struct stat *source_stat) {
#ifdef __APPLE__
  return (double)source_stat->st_ctimespec.tv_sec * 1000.0 +
         (double)source_stat->st_ctimespec.tv_nsec / 1000000.0;
#else
  return (double)source_stat->st_ctim.tv_sec * 1000.0 +
         (double)source_stat->st_ctim.tv_nsec / 1000000.0;
#endif
}

static int source_stat_matches_identity(const struct stat *source_stat,
                                        const local_source_identity_t *identity) {
  return source_stat->st_size >= 0 &&
         (uint64_t)source_stat->st_dev == identity->device &&
         (uint64_t)source_stat->st_ino == identity->inode &&
         (uint64_t)source_stat->st_size == identity->size &&
         source_stat_modified_ms(source_stat) == identity->modified_ms &&
         source_stat_changed_ms(source_stat) == identity->changed_ms;
}

static int send_file_to_device(LIBMTP_mtpdevice_t *device,
                               const char *source,
                               const char *destination_name,
                               uint32_t storage_id,
                               uint32_t parent_id,
                               const local_source_identity_t *expected_source_identity,
                               LIBMTP_progressfunc_t progress_func,
                               uint32_t *uploaded_object_id,
                               uint64_t *uploaded_size) {
  const char *filename = destination_name != NULL ? destination_name : path_basename(source);
  if (*filename == '\0') {
    return -3;
  }

  int source_fd = open(source, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (source_fd < 0) {
    return -1;
  }

  struct stat source_stat;
  if (fstat(source_fd, &source_stat) != 0) {
    close(source_fd);
    return -1;
  }
  if (!S_ISREG(source_stat.st_mode)) {
    close(source_fd);
    return -2;
  }
  if (expected_source_identity != NULL &&
      !source_stat_matches_identity(&source_stat, expected_source_identity)) {
    close(source_fd);
    return -6;
  }

  int conflict_status = phone_file_conflict_status(
      device,
      filename,
      storage_id,
      parent_id);
  if (conflict_status == 2) {
    close(source_fd);
    return -5;
  }

  LIBMTP_file_t *metadata = LIBMTP_new_file_t();
  if (metadata == NULL) {
    close(source_fd);
    return -4;
  }

  metadata->filename = strdup(filename);
  if (metadata->filename == NULL) {
    LIBMTP_destroy_file_t(metadata);
    close(source_fd);
    return -4;
  }

  if (fstat(source_fd, &source_stat) != 0 ||
      !S_ISREG(source_stat.st_mode) ||
      (expected_source_identity != NULL &&
       !source_stat_matches_identity(&source_stat, expected_source_identity))) {
    LIBMTP_destroy_file_t(metadata);
    close(source_fd);
    return -6;
  }

  metadata->filesize = (uint64_t)source_stat.st_size;
  metadata->parent_id = parent_id;
  metadata->storage_id = storage_id;
  metadata->modificationdate = source_stat.st_mtime;
  metadata->filetype = filetype_for_name(filename);

  int result = LIBMTP_Send_File_From_File_Descriptor(
      device, source_fd, metadata, progress_func, NULL);
  close(source_fd);
  if (result == 0) {
    if (uploaded_object_id != NULL) {
      *uploaded_object_id = metadata->item_id;
    }
    if (uploaded_size != NULL) {
      *uploaded_size = metadata->filesize;
    }
  }
  LIBMTP_destroy_file_t(metadata);
  return result;
}

static uint32_t verified_uploaded_file_id(LIBMTP_mtpdevice_t *device,
                                          uint32_t object_id,
                                          uint32_t storage_id,
                                          uint32_t parent_id,
                                          const char *filename,
                                          uint64_t expected_size) {
  if (object_id == 0) {
    return 0;
  }

  LIBMTP_file_t *metadata = LIBMTP_Get_Filemetadata(device, object_id);
  if (metadata != NULL) {
    int matches = metadata->item_id == object_id &&
                  metadata->filename != NULL &&
                  strcmp(metadata->filename, filename) == 0 &&
                  metadata->filesize == expected_size;
    LIBMTP_destroy_file_t(metadata);
    if (matches) {
      return object_id;
    }
  }
  LIBMTP_Clear_Errorstack(device);

  LIBMTP_file_t *files = LIBMTP_Get_Files_And_Folders(device, storage_id, parent_id);
  LIBMTP_file_t *file = files;
  uint32_t verified_id = 0;
  while (file != NULL) {
    LIBMTP_file_t *current = file;
    file = file->next;
    if (verified_id == 0 &&
        current->item_id == object_id &&
        current->filename != NULL &&
        strcmp(current->filename, filename) == 0 &&
        current->filesize == expected_size &&
        current->filetype != LIBMTP_FILETYPE_FOLDER) {
      verified_id = current->item_id;
    }
    LIBMTP_destroy_file_t(current);
  }
  if (verified_id == 0) {
    LIBMTP_Dump_Errorstack(device);
    LIBMTP_Clear_Errorstack(device);
  }
  return verified_id;
}

static uint32_t create_folder_on_device(LIBMTP_mtpdevice_t *device,
                                        const char *name,
                                        uint32_t storage_id,
                                        uint32_t parent_id) {
  if (name == NULL || *name == '\0' || storage_id == 0) {
    return 0;
  }

  char *folder_name = strdup(name);
  if (folder_name == NULL) {
    return 0;
  }

  uint32_t folder_id = LIBMTP_Create_Folder(device, folder_name, parent_id, storage_id);
  free(folder_name);
  return folder_id;
}

static int command_download(int argc, char **argv) {
  if (argc < 5) {
    fprintf(stderr, "usage: mtp-json download <device-index> <object-id> <destination-path>\n");
    return 2;
  }

  int device_index = 0;
  uint32_t object_id = 0;
  const char *destination = argv[4];
  LIBMTP_raw_device_t *rawdevices = NULL;
  int numrawdevices = 0;
  LIBMTP_error_number_t err;

  if (!parse_nonnegative_int(argv[2], &device_index)) {
    fprintf(stderr, "invalid device index: %s\n", argv[2]);
    return 2;
  }
  if (!parse_u32(argv[3], &object_id) || object_id == 0) {
    fprintf(stderr, "invalid object id: %s\n", argv[3]);
    return 2;
  }

  LIBMTP_Init();
  err = LIBMTP_Detect_Raw_Devices(&rawdevices, &numrawdevices);
  if (err != LIBMTP_ERROR_NONE) {
    printf("{\"event\":\"failed\",\"message\":");
    json_string(detect_error_message(err));
    printf("}\n");
    return 1;
  }

  if (device_index < 0 || device_index >= numrawdevices) {
    fprintf(stderr, "invalid device index: %d\n", device_index);
    LIBMTP_FreeMemory(rawdevices);
    return 2;
  }

  LIBMTP_mtpdevice_t *device = LIBMTP_Open_Raw_Device_Uncached(&rawdevices[device_index]);
  if (device == NULL) {
    printf("{\"event\":\"failed\",\"message\":");
    json_string(blocked_normal_access_message());
    printf("}\n");
    LIBMTP_FreeMemory(rawdevices);
    return 1;
  }

  printf("{\"event\":\"started\",\"objectId\":%u,\"destination\":", object_id);
  json_string(destination);
  printf("}\n");
  fflush(stdout);

  last_progress_sent = 0;
  int result = LIBMTP_Get_File_To_File(device, object_id, destination, progress_callback, NULL);
  if (result != 0) {
    printf("{\"event\":\"failed\",\"message\":\"libmtp could not copy the file from the device.\"}\n");
    LIBMTP_Dump_Errorstack(device);
    LIBMTP_Clear_Errorstack(device);
  } else {
    printf("{\"event\":\"complete\",\"objectId\":%u,\"destination\":", object_id);
    json_string(destination);
    printf("}\n");
  }

  LIBMTP_Release_Device(device);
  LIBMTP_FreeMemory(rawdevices);
  return result == 0 ? 0 : 1;
}

static int command_mkdir(int argc, char **argv) {
  if (argc < 6) {
    fprintf(stderr, "usage: mtp-json mkdir <device-index> <storage-id> <parent-id> <folder-name>\n");
    return 2;
  }

  int device_index = 0;
  uint32_t storage_id = 0;
  uint32_t parent_id = 0;
  const char *name = argv[5];
  LIBMTP_raw_device_t *rawdevices = NULL;
  int numrawdevices = 0;
  LIBMTP_error_number_t err;

  if (!parse_nonnegative_int(argv[2], &device_index) ||
      !parse_u32(argv[3], &storage_id) ||
      !parse_u32(argv[4], &parent_id) ||
      storage_id == 0 ||
      *name == '\0') {
    fprintf(stderr, "invalid folder destination\n");
    return 2;
  }

  LIBMTP_Init();
  err = LIBMTP_Detect_Raw_Devices(&rawdevices, &numrawdevices);
  if (err != LIBMTP_ERROR_NONE) {
    printf("{\"event\":\"failed\",\"message\":");
    json_string(detect_error_message(err));
    printf("}\n");
    return 1;
  }

  if (device_index < 0 || device_index >= numrawdevices) {
    fprintf(stderr, "invalid device index: %d\n", device_index);
    LIBMTP_FreeMemory(rawdevices);
    return 2;
  }

  LIBMTP_mtpdevice_t *device = LIBMTP_Open_Raw_Device_Uncached(&rawdevices[device_index]);
  if (device == NULL) {
    printf("{\"event\":\"failed\",\"message\":");
    json_string(blocked_normal_access_message());
    printf("}\n");
    LIBMTP_FreeMemory(rawdevices);
    return 1;
  }

  uint32_t folder_id = create_folder_on_device(device, name, storage_id, parent_id);
  if (folder_id == 0) {
    printf("{\"event\":\"failed\",\"message\":\"libmtp could not create the folder on the device.\"}\n");
    LIBMTP_Dump_Errorstack(device);
    LIBMTP_Clear_Errorstack(device);
  } else {
    printf("{\"event\":\"complete\",\"folderId\":%u,\"name\":", folder_id);
    json_string(name);
    printf(",\"storageId\":%u,\"parentId\":%u}\n", storage_id, parent_id);
  }

  LIBMTP_Release_Device(device);
  LIBMTP_FreeMemory(rawdevices);
  return folder_id == 0 ? 1 : 0;
}

static int command_upload(int argc, char **argv) {
  if (argc < 6) {
    fprintf(stderr, "usage: mtp-json upload <device-index> <storage-id> <parent-id> <source-path>\n");
    return 2;
  }

  int device_index = 0;
  uint32_t storage_id = 0;
  uint32_t parent_id = 0;
  const char *source = argv[5];
  LIBMTP_raw_device_t *rawdevices = NULL;
  int numrawdevices = 0;
  LIBMTP_error_number_t err;

  if (!parse_nonnegative_int(argv[2], &device_index) ||
      !parse_u32(argv[3], &storage_id) ||
      !parse_u32(argv[4], &parent_id) ||
      storage_id == 0) {
    fprintf(stderr, "invalid upload destination\n");
    return 2;
  }

  LIBMTP_Init();
  err = LIBMTP_Detect_Raw_Devices(&rawdevices, &numrawdevices);
  if (err != LIBMTP_ERROR_NONE) {
    printf("{\"event\":\"failed\",\"message\":");
    json_string(detect_error_message(err));
    printf("}\n");
    return 1;
  }

  if (device_index < 0 || device_index >= numrawdevices) {
    fprintf(stderr, "invalid device index: %d\n", device_index);
    LIBMTP_FreeMemory(rawdevices);
    return 2;
  }

  LIBMTP_mtpdevice_t *device = LIBMTP_Open_Raw_Device_Uncached(&rawdevices[device_index]);
  if (device == NULL) {
    printf("{\"event\":\"failed\",\"message\":");
    json_string(blocked_normal_access_message());
    printf("}\n");
    LIBMTP_FreeMemory(rawdevices);
    return 1;
  }

  printf("{\"event\":\"started\",\"source\":");
  json_string(source);
  printf(",\"storageId\":%u,\"parentId\":%u}\n", storage_id, parent_id);
  fflush(stdout);

  last_progress_sent = 0;
  uint32_t uploaded_object_id = 0;
  uint64_t uploaded_size = 0;
  int result = send_file_to_device(
      device,
      source,
      path_basename(source),
      storage_id,
      parent_id,
      NULL,
      progress_callback,
      &uploaded_object_id,
      &uploaded_size);
  if (result != 0) {
    const char *message = "libmtp could not copy the file to the device.";
    if (result == -5) {
      message = "A different item with the same name is already on the phone. Nothing was overwritten.";
    }
    printf("{\"event\":\"failed\",\"message\":");
    json_string(message);
    printf("}\n");
    LIBMTP_Dump_Errorstack(device);
    LIBMTP_Clear_Errorstack(device);
  } else {
    uint32_t verified_object_id = verified_uploaded_file_id(
        device,
        uploaded_object_id,
        storage_id,
        parent_id,
        path_basename(source),
        uploaded_size);
    printf("{\"event\":\"complete\",\"source\":");
    json_string(source);
    printf(",\"storageId\":%u,\"parentId\":%u,\"objectId\":%u,\"verified\":%s}\n",
           storage_id,
           parent_id,
           verified_object_id != 0 ? verified_object_id : uploaded_object_id,
           verified_object_id != 0 ? "true" : "false");
  }

  LIBMTP_Release_Device(device);
  LIBMTP_FreeMemory(rawdevices);
  return result == 0 ? 0 : 1;
}

static void session_inventory(const char *request_id,
                              int device_index,
                              LIBMTP_raw_device_t *rawdevice,
                              LIBMTP_mtpdevice_t *device,
                              int *storage_mode) {
  /*
   * Samsung phones answer the first storage request with an empty list while
   * the user is still deciding on the Android "Allow access" prompt. Only a
   * real storage list may be cached for the rest of the session; the synthetic
   * Phone storage placeholder (mode 2) must re-query the phone on every
   * inventory so Retry can observe the newly granted storage.
   */
  if (*storage_mode != 1) {
    *storage_mode = prepare_device_storage(device, rawdevice);
  }

  printf("{\"type\":\"response\",\"requestId\":");
  json_string(request_id);
  if (*storage_mode == 0) {
    const char *storage_error = first_mtp_error_text(device);
    printf(",\"ok\":false,\"state\":\"error\",\"message\":");
    json_string(storage_error != NULL
                    ? storage_error
                    : "The phone session opened, but the phone did not return usable storage information.");
    printf(",\"devices\":[]}\n");
    LIBMTP_Clear_Errorstack(device);
    fflush(stdout);
    return;
  }

  printf(",\"ok\":true,\"state\":\"connected\",\"message\":\"Inventory scan completed.\",\"devices\":[");
  print_inventory_device(device_index, rawdevice, device, *storage_mode);
  printf("]}\n");
  fflush(stdout);
}

static void clear_session_fallback_files(LIBMTP_file_t **fallback_files,
                                         int *fallback_attempted) {
  if (*fallback_files != NULL) {
    destroy_file_list(*fallback_files);
    *fallback_files = NULL;
  }
  *fallback_attempted = 0;
}

static void session_list(const char *request_id,
                         int device_index,
                         LIBMTP_raw_device_t *rawdevice,
                         LIBMTP_mtpdevice_t *device,
                         uint32_t storage_id,
                         uint32_t parent_id,
                         LIBMTP_file_t **fallback_files,
                         int *fallback_attempted) {
  LIBMTP_file_t *files = LIBMTP_Get_Files_And_Folders(device, storage_id, parent_id);
  const char *list_error = files == NULL ? first_mtp_error_text(device) : NULL;
  if (files == NULL && is_inferred_samsung_storage(rawdevice, storage_id)) {
    ensure_session_fallback_files(device, request_id, fallback_files, fallback_attempted);

    printf("{\"type\":\"response\",\"requestId\":");
    json_string(request_id);
    if (*fallback_files == NULL) {
      const char *fallback_error = first_mtp_error_text(device);
      printf(",\"ok\":false,\"state\":\"error\",\"message\":");
      json_string(fallback_error != NULL
                      ? fallback_error
                      : "The phone file index could not be read. Retry will try again without reconnecting.");
      printf(",\"deviceIndex\":%d,\"storageId\":%u,\"parentId\":%u,\"objects\":[]}\n",
             device_index,
             storage_id,
             parent_id);
      LIBMTP_Clear_Errorstack(device);
      fflush(stdout);
      return;
    }

    printf(",\"ok\":true,\"state\":\"connected\",\"message\":\"Folder listed with Samsung storage fallback.\",\"deviceIndex\":%d,\"storageId\":%u,\"parentId\":%u,\"objects\":[",
           device_index,
           storage_id,
           parent_id);
    int first_object = 1;
    print_filelisting_fallback_objects(
        *fallback_files,
        rawdevice,
        storage_id,
        parent_id,
        &first_object);
    LIBMTP_Clear_Errorstack(device);
    printf("]}\n");
    fflush(stdout);
    return;
  }

  printf("{\"type\":\"response\",\"requestId\":");
  json_string(request_id);
  if (files == NULL && (list_error != NULL || parent_id == ROOT_PARENT_ID)) {
    printf(",\"ok\":false,\"state\":\"error\",\"message\":");
    json_string(list_error != NULL ? list_error : empty_storage_root_message());
    printf(",\"deviceIndex\":%d,\"storageId\":%u,\"parentId\":%u,\"objects\":[]}\n",
           device_index,
           storage_id,
           parent_id);
    LIBMTP_Clear_Errorstack(device);
    fflush(stdout);
    return;
  }

  printf(",\"ok\":true,\"state\":\"connected\",\"message\":\"Folder listed.\",\"deviceIndex\":%d,\"storageId\":%u,\"parentId\":%u,\"objects\":[",
         device_index,
         storage_id,
         parent_id);

  int first_object = 1;
  LIBMTP_file_t *file = files;
  while (file != NULL) {
    LIBMTP_file_t *current = file;
    file = file->next;
    print_object(current, &first_object);
    LIBMTP_destroy_file_t(current);
  }

  printf("]}\n");
  fflush(stdout);
}

static void session_mkdir(const char *request_id,
                          LIBMTP_mtpdevice_t *device,
                          uint32_t storage_id,
                          uint32_t parent_id,
                          const char *name) {
  uint32_t folder_id = create_folder_on_device(device, name, storage_id, parent_id);

  printf("{\"type\":\"response\",\"requestId\":");
  json_string(request_id);
  if (folder_id == 0) {
    printf(",\"ok\":false,\"event\":\"failed\",\"message\":\"libmtp could not create the folder on the device.\"}\n");
    LIBMTP_Dump_Errorstack(device);
    LIBMTP_Clear_Errorstack(device);
  } else {
    printf(",\"ok\":true,\"event\":\"complete\",\"folderId\":%u,\"name\":", folder_id);
    json_string(name);
    printf(",\"storageId\":%u,\"parentId\":%u}\n", storage_id, parent_id);
  }
  fflush(stdout);
}

static void session_download(const char *request_id,
                             LIBMTP_mtpdevice_t *device,
                             uint32_t object_id,
                             const char *destination) {
  printf("{\"type\":\"download\",\"requestId\":");
  json_string(request_id);
  printf(",\"event\":\"started\",\"objectId\":%u,\"destination\":", object_id);
  json_string(destination);
  printf("}\n");
  fflush(stdout);

  session_transfer_type = "download";
  session_transfer_request_id = request_id;
  session_last_progress_sent = 0;
  int result = LIBMTP_Get_File_To_File(device, object_id, destination, session_progress_callback, NULL);
  session_transfer_request_id = "";

  printf("{\"type\":\"response\",\"requestId\":");
  json_string(request_id);
  if (result != 0) {
    printf(",\"ok\":false,\"event\":\"failed\",\"message\":\"libmtp could not copy the file from the device.\"}\n");
    LIBMTP_Dump_Errorstack(device);
    LIBMTP_Clear_Errorstack(device);
  } else {
    printf(",\"ok\":true,\"event\":\"complete\",\"objectId\":%u,\"destination\":", object_id);
    json_string(destination);
    printf("}\n");
  }
  fflush(stdout);
}

static void session_upload(const char *request_id,
                           LIBMTP_mtpdevice_t *device,
                           uint32_t storage_id,
                           uint32_t parent_id,
                           const char *destination_name,
                           const local_source_identity_t *source_identity,
                           const char *source) {
  printf("{\"type\":\"upload\",\"requestId\":");
  json_string(request_id);
  printf(",\"event\":\"started\",\"source\":");
  json_string(source);
  printf(",\"destinationName\":");
  json_string(destination_name);
  printf(",\"storageId\":%u,\"parentId\":%u}\n", storage_id, parent_id);
  fflush(stdout);

  session_transfer_type = "upload";
  session_transfer_request_id = request_id;
  session_last_progress_sent = 0;
  uint32_t uploaded_object_id = 0;
  uint64_t uploaded_size = 0;
  int result = send_file_to_device(
      device,
      source,
      destination_name,
      storage_id,
      parent_id,
      source_identity,
      session_progress_callback,
      &uploaded_object_id,
      &uploaded_size);
  session_transfer_request_id = "";
  session_transfer_type = "download";

  printf("{\"type\":\"response\",\"requestId\":");
  json_string(request_id);
  if (result != 0) {
    const char *message = "libmtp could not copy the file to the device.";
    if (result == -1) {
      message = "The Mac file no longer exists or cannot be read.";
    } else if (result == -2) {
      message = "Folders cannot be uploaded yet. Choose files only.";
    } else if (result == -3) {
      message = "The Mac file name is not valid for upload.";
    } else if (result == -4) {
      message = "The MTP helper could not prepare file metadata.";
    } else if (result == -5) {
      message = "A different item with the same name is already on the phone. Nothing was overwritten.";
    } else if (result == -6) {
      message = "The Mac file changed after it was queued, so it was not uploaded.";
    }
    printf(",\"ok\":false,\"event\":\"failed\",\"message\":");
    json_string(message);
    printf("}\n");
    LIBMTP_Dump_Errorstack(device);
    LIBMTP_Clear_Errorstack(device);
  } else {
    uint32_t verified_object_id = verified_uploaded_file_id(
        device,
        uploaded_object_id,
        storage_id,
        parent_id,
        destination_name,
        uploaded_size);
    printf(",\"ok\":true,\"event\":\"complete\",\"source\":");
    json_string(source);
    printf(",\"storageId\":%u,\"parentId\":%u,\"objectId\":%u,\"verified\":%s}\n",
           storage_id,
           parent_id,
           verified_object_id != 0 ? verified_object_id : uploaded_object_id,
           verified_object_id != 0 ? "true" : "false");
  }
  fflush(stdout);
}

static void print_phone_mutation_failure(const char *request_id, const char *message) {
  printf("{\"type\":\"response\",\"requestId\":");
  json_string(request_id);
  printf(",\"ok\":false,\"event\":\"failed\",\"message\":");
  json_string(message);
  printf("}\n");
  fflush(stdout);
}

static LIBMTP_file_t *verified_phone_mutation_target(const char *request_id,
                                                     LIBMTP_mtpdevice_t *device,
                                                     uint32_t object_id,
                                                     uint32_t storage_id,
                                                     uint32_t parent_id,
                                                     const char *kind,
                                                     uint64_t expected_size,
                                                     int expected_size_available,
                                                     uint64_t expected_modified,
                                                     int expected_modified_available,
                                                     const char *expected_name) {
  LIBMTP_file_t *metadata = LIBMTP_Get_Filemetadata(device, object_id);
  if (metadata == NULL) {
    const char *error = first_mtp_error_text(device);
    print_phone_mutation_failure(
        request_id,
        error != NULL ? error : "The selected phone item no longer exists. Refresh the folder and try again.");
    LIBMTP_Clear_Errorstack(device);
    return NULL;
  }

  int expected_folder = strcmp(kind, "folder") == 0;
  int actual_folder = metadata->filetype == LIBMTP_FILETYPE_FOLDER;
  int storage_matches = storage_id == INFERRED_STORAGE_ID ||
                        metadata->storage_id == 0 ||
                        metadata->storage_id == storage_id;
  int file_metadata_matches = expected_folder
      ? !expected_size_available && !expected_modified_available
      : expected_size_available &&
        metadata->filesize == expected_size &&
        (!expected_modified_available ||
         (metadata->modificationdate >= 0 &&
          (uint64_t)metadata->modificationdate == expected_modified));
  if (metadata->item_id != object_id ||
      metadata->parent_id != parent_id ||
      !storage_matches ||
      expected_folder != actual_folder ||
      !file_metadata_matches ||
      metadata->filename == NULL ||
      strcmp(metadata->filename, expected_name) != 0) {
    LIBMTP_destroy_file_t(metadata);
    print_phone_mutation_failure(
        request_id,
        "The selected phone item changed since it was listed. Refresh the folder and try again.");
    return NULL;
  }
  return metadata;
}

static void session_rename_item(const char *request_id,
                                LIBMTP_mtpdevice_t *device,
                                uint32_t object_id,
                                uint32_t storage_id,
                                uint32_t parent_id,
                                const char *kind,
                                uint64_t expected_size,
                                int expected_size_available,
                                uint64_t expected_modified,
                                int expected_modified_available,
                                const char *expected_name,
                                const char *new_name) {
  LIBMTP_file_t *metadata = verified_phone_mutation_target(
      request_id,
      device,
      object_id,
      storage_id,
      parent_id,
      kind,
      expected_size,
      expected_size_available,
      expected_modified,
      expected_modified_available,
      expected_name);
  if (metadata == NULL) {
    return;
  }

  int result = LIBMTP_Set_File_Name(device, metadata, new_name);
  if (result != 0) {
    const char *error = first_mtp_error_text(device);
    LIBMTP_destroy_file_t(metadata);
    print_phone_mutation_failure(
        request_id,
        error != NULL ? error : "This phone did not accept the new name.");
    LIBMTP_Dump_Errorstack(device);
    LIBMTP_Clear_Errorstack(device);
    return;
  }

  char *accepted_name = strdup(metadata->filename != NULL ? metadata->filename : new_name);
  LIBMTP_destroy_file_t(metadata);
  LIBMTP_file_t *updated = LIBMTP_Get_Filemetadata(device, object_id);
  int verified = updated != NULL && updated->filename != NULL;
  const char *actual_name = verified ? updated->filename : accepted_name;

  printf("{\"type\":\"response\",\"requestId\":");
  json_string(request_id);
  printf(",\"ok\":true,\"event\":\"complete\",\"objectId\":%u,\"actualName\":", object_id);
  json_string(actual_name != NULL ? actual_name : new_name);
  printf(",\"verified\":%s}\n", verified ? "true" : "false");
  fflush(stdout);

  if (updated != NULL) {
    LIBMTP_destroy_file_t(updated);
  } else {
    LIBMTP_Clear_Errorstack(device);
  }
  free(accepted_name);
}

static void session_delete_item(const char *request_id,
                                LIBMTP_mtpdevice_t *device,
                                uint32_t object_id,
                                uint32_t storage_id,
                                uint32_t parent_id,
                                const char *kind,
                                uint64_t expected_size,
                                int expected_size_available,
                                uint64_t expected_modified,
                                int expected_modified_available,
                                const char *expected_name) {
  LIBMTP_file_t *metadata = verified_phone_mutation_target(
      request_id,
      device,
      object_id,
      storage_id,
      parent_id,
      kind,
      expected_size,
      expected_size_available,
      expected_modified,
      expected_modified_available,
      expected_name);
  if (metadata == NULL) {
    return;
  }
  LIBMTP_destroy_file_t(metadata);

  int result = LIBMTP_Delete_Object(device, object_id);
  if (result != 0) {
    const char *error = first_mtp_error_text(device);
    print_phone_mutation_failure(
        request_id,
        error != NULL ? error : "The phone could not permanently delete this item.");
    LIBMTP_Dump_Errorstack(device);
    LIBMTP_Clear_Errorstack(device);
    return;
  }

  printf("{\"type\":\"response\",\"requestId\":");
  json_string(request_id);
  printf(",\"ok\":true,\"event\":\"complete\",\"objectId\":%u}\n", object_id);
  fflush(stdout);
}

static int command_session(int argc, char **argv) {
  if (argc < 3) {
    fprintf(stderr, "usage: mtp-json session <device-index>\n");
    return 2;
  }

  int device_index = 0;
  LIBMTP_raw_device_t *rawdevices = NULL;
  LIBMTP_file_t *fallback_files = NULL;
  int fallback_attempted = 0;
  int storage_mode = 0;
  int numrawdevices = 0;
  LIBMTP_error_number_t err;

  if (!parse_nonnegative_int(argv[2], &device_index)) {
    fprintf(stderr, "invalid device index: %s\n", argv[2]);
    return 2;
  }

  LIBMTP_Init();
  err = LIBMTP_Detect_Raw_Devices(&rawdevices, &numrawdevices);
  if (err != LIBMTP_ERROR_NONE) {
    printf("{\"type\":\"ready\",\"ok\":false,\"state\":");
    json_string(detect_error_state(err));
    printf(",\"message\":");
    json_string(detect_error_message(err));
    printf("}\n");
    if (rawdevices != NULL) {
      LIBMTP_FreeMemory(rawdevices);
    }
    return err == LIBMTP_ERROR_NO_DEVICE_ATTACHED ? 0 : 1;
  }

  if (device_index < 0 || device_index >= numrawdevices) {
    printf("{\"type\":\"ready\",\"ok\":false,\"state\":\"error\",\"message\":\"Invalid MTP device index.\"}\n");
    LIBMTP_FreeMemory(rawdevices);
    return 2;
  }

  LIBMTP_mtpdevice_t *device = LIBMTP_Open_Raw_Device_Uncached(&rawdevices[device_index]);
  if (device == NULL) {
    printf("{\"type\":\"ready\",\"ok\":false,\"state\":\"connect-error\",\"message\":");
    json_string(blocked_normal_access_message());
    printf("}\n");
    LIBMTP_FreeMemory(rawdevices);
    return 1;
  }

  printf("{\"type\":\"ready\",\"ok\":true,\"state\":\"connected\",\"message\":\"MTP session opened.\",\"deviceIndex\":%d,\"bus\":%u,\"device\":%u,\"vendorId\":%u,\"productId\":%u",
         device_index,
         rawdevices[device_index].bus_location,
         rawdevices[device_index].devnum,
         rawdevices[device_index].device_entry.vendor_id,
         rawdevices[device_index].device_entry.product_id);
#ifdef __APPLE__
  android_usb_fallback_device_t ready_metadata;
  memset(&ready_metadata, 0, sizeof(ready_metadata));
  if (iokit_metadata_for_raw_device(rawdevices[device_index].device_entry.vendor_id,
                                    rawdevices[device_index].device_entry.product_id,
                                    rawdevices[device_index].bus_location,
                                    rawdevices[device_index].devnum,
                                    &ready_metadata)) {
    if (ready_metadata.serial[0] != '\0') {
      printf(",\"serial\":");
      json_string(ready_metadata.serial);
    }
    if (ready_metadata.usb_session_id[0] != '\0') {
      printf(",\"usbSessionId\":");
      json_string(ready_metadata.usb_session_id);
    }
  }
#endif
  printf("}\n");
  fflush(stdout);

  char line[8192];
  while (fgets(line, sizeof(line), stdin) != NULL) {
    char *cursor = line;
    char *command = next_token(&cursor);
    if (command == NULL) {
      continue;
    }

    if (strcmp(command, "quit") == 0) {
      printf("{\"type\":\"bye\",\"ok\":true}\n");
      fflush(stdout);
      break;
    }

    char *request_id = next_token(&cursor);
    if (request_id == NULL) {
      print_session_error("", "Missing request id.");
      continue;
    }

    if (strcmp(command, "inventory") == 0) {
      session_inventory(request_id, device_index, &rawdevices[device_index], device, &storage_mode);
      continue;
    }

    if (strcmp(command, "list") == 0) {
      uint32_t storage_id = 0;
      uint32_t parent_id = 0;
      char *storage_token = next_token(&cursor);
      char *parent_token = next_token(&cursor);
      if (!parse_u32(storage_token, &storage_id) || !parse_u32(parent_token, &parent_id) || storage_id == 0) {
        print_session_error(request_id, "Invalid list command.");
        continue;
      }
      session_list(
          request_id,
          device_index,
          &rawdevices[device_index],
          device,
          storage_id,
          parent_id,
          &fallback_files,
          &fallback_attempted);
      continue;
    }

    if (strcmp(command, "mkdir") == 0) {
      uint32_t storage_id = 0;
      uint32_t parent_id = 0;
      char *storage_token = next_token(&cursor);
      char *parent_token = next_token(&cursor);
      char *name = rest_token(&cursor);
      if (!parse_u32(storage_token, &storage_id) ||
          !parse_u32(parent_token, &parent_id) ||
          storage_id == 0 ||
          name == NULL ||
          *name == '\0') {
        print_session_error(request_id, "Invalid mkdir command.");
        continue;
      }
      if (storage_id == INFERRED_STORAGE_ID) {
        LIBMTP_file_t *storage_files = ensure_session_fallback_files(
            device,
            request_id,
            &fallback_files,
            &fallback_attempted);
        storage_id = inferred_storage_id_for_write(storage_files);
        if (storage_id == 0) {
          print_session_error(
              request_id,
              "The phone did not expose one writable storage identifier, so this folder was not created.");
          LIBMTP_Clear_Errorstack(device);
          continue;
        }
      }
      session_mkdir(request_id, device, storage_id, parent_id, name);
      clear_session_fallback_files(&fallback_files, &fallback_attempted);
      continue;
    }

    if (strcmp(command, "download") == 0) {
      uint32_t object_id = 0;
      char *object_token = next_token(&cursor);
      char *destination = rest_token(&cursor);
      if (!parse_u32(object_token, &object_id) || object_id == 0 || destination == NULL || *destination == '\0') {
        print_session_error(request_id, "Invalid download command.");
        continue;
      }
      session_download(request_id, device, object_id, destination);
      continue;
    }

    if (strcmp(command, "upload") == 0) {
      uint32_t storage_id = 0;
      uint32_t parent_id = 0;
      char *storage_token = next_token(&cursor);
      char *parent_token = next_token(&cursor);
      char *destination_name_token = next_token(&cursor);
      char *source_device_token = next_token(&cursor);
      char *source_inode_token = next_token(&cursor);
      char *source_size_token = next_token(&cursor);
      char *source_modified_token = next_token(&cursor);
      char *source_changed_token = next_token(&cursor);
      char *source = rest_token(&cursor);
      char *destination_name = NULL;
      local_source_identity_t source_identity;
      memset(&source_identity, 0, sizeof(source_identity));
      if (!parse_u32(storage_token, &storage_id) ||
          !parse_u32(parent_token, &parent_id) ||
          storage_id == 0 ||
          !decode_phone_item_name(destination_name_token, 1, &destination_name) ||
          !parse_u64(source_device_token, &source_identity.device) ||
          !parse_u64(source_inode_token, &source_identity.inode) ||
          !parse_u64(source_size_token, &source_identity.size) ||
          !parse_finite_double(source_modified_token, &source_identity.modified_ms) ||
          !parse_finite_double(source_changed_token, &source_identity.changed_ms) ||
          source == NULL ||
          *source == '\0') {
        free(destination_name);
        print_session_error(request_id, "Invalid upload command.");
        continue;
      }
      if (storage_id == INFERRED_STORAGE_ID) {
        LIBMTP_file_t *storage_files = ensure_session_fallback_files(
            device,
            request_id,
            &fallback_files,
            &fallback_attempted);
        storage_id = inferred_storage_id_for_write(storage_files);
        if (storage_id == 0) {
          print_session_error(
              request_id,
              "The phone did not expose one writable storage identifier, so this file was not uploaded.");
          LIBMTP_Clear_Errorstack(device);
          free(destination_name);
          continue;
        }
      }
      session_upload(
          request_id,
          device,
          storage_id,
          parent_id,
          destination_name,
          &source_identity,
          source);
      free(destination_name);
      clear_session_fallback_files(&fallback_files, &fallback_attempted);
      continue;
    }

    if (strcmp(command, "rename-item") == 0 || strcmp(command, "delete-item") == 0) {
      uint32_t object_id = 0;
      uint32_t storage_id = 0;
      uint32_t parent_id = 0;
      char *object_token = next_token(&cursor);
      char *storage_token = next_token(&cursor);
      char *parent_token = next_token(&cursor);
      char *kind = next_token(&cursor);
      char *expected_size_token = next_token(&cursor);
      char *expected_modified_token = next_token(&cursor);
      char *expected_name_token = next_token(&cursor);
      char *new_name_token = strcmp(command, "rename-item") == 0 ? next_token(&cursor) : NULL;
      char *expected_name = NULL;
      char *new_name = NULL;
      uint64_t expected_size = 0;
      uint64_t expected_modified = 0;
      int expected_size_available = 0;
      int expected_modified_available = 0;
      int valid_kind = kind != NULL && (strcmp(kind, "file") == 0 || strcmp(kind, "folder") == 0);
      int expected_folder = valid_kind && strcmp(kind, "folder") == 0;
      int valid = parse_u32(object_token, &object_id) && object_id != 0 &&
                  parse_u32(storage_token, &storage_id) && storage_id != 0 &&
                  parse_u32(parent_token, &parent_id) && valid_kind &&
                  parse_optional_u64(
                      expected_size_token, &expected_size, &expected_size_available) &&
                  parse_optional_u64(
                      expected_modified_token, &expected_modified, &expected_modified_available) &&
                  decode_phone_item_name(expected_name_token, 0, &expected_name);
      int valid_file_metadata = expected_folder
          ? !expected_size_available && !expected_modified_available
          : expected_size_available &&
            (!expected_modified_available || expected_modified > 0);
      valid = valid && valid_file_metadata;
      if (valid && new_name_token != NULL) {
        valid = decode_phone_item_name(new_name_token, 1, &new_name);
      }
      if (!valid || (strcmp(command, "rename-item") == 0 && new_name == NULL)) {
        free(expected_name);
        free(new_name);
        print_session_error(request_id, "Invalid phone mutation command.");
        continue;
      }

      if (strcmp(command, "rename-item") == 0) {
        session_rename_item(
            request_id,
            device,
            object_id,
            storage_id,
            parent_id,
            kind,
            expected_size,
            expected_size_available,
            expected_modified,
            expected_modified_available,
            expected_name,
            new_name);
      } else {
        session_delete_item(
            request_id,
            device,
            object_id,
            storage_id,
            parent_id,
            kind,
            expected_size,
            expected_size_available,
            expected_modified,
            expected_modified_available,
            expected_name);
      }
      free(expected_name);
      free(new_name);
      clear_session_fallback_files(&fallback_files, &fallback_attempted);
      continue;
    }

    print_session_error(request_id, "Unknown session command.");
  }

  clear_session_fallback_files(&fallback_files, &fallback_attempted);
  LIBMTP_Release_Device(device);
  LIBMTP_FreeMemory(rawdevices);
  return 0;
}

int main(int argc, char **argv) {
  setvbuf(stdout, NULL, _IOLBF, 0);

  if (argc < 2) {
    fprintf(stderr, "usage: mtp-json <status|inventory|reset|list|download|mkdir|upload|session>\n");
    return 2;
  }

  if (strcmp(argv[1], "status") == 0) {
    return command_status();
  }

  if (strcmp(argv[1], "inventory") == 0) {
    return command_inventory();
  }

  if (strcmp(argv[1], "reset") == 0) {
    return command_reset();
  }

  if (strcmp(argv[1], "list") == 0) {
    return command_list(argc, argv);
  }

  if (strcmp(argv[1], "download") == 0) {
    return command_download(argc, argv);
  }

  if (strcmp(argv[1], "mkdir") == 0) {
    return command_mkdir(argc, argv);
  }

  if (strcmp(argv[1], "upload") == 0) {
    return command_upload(argc, argv);
  }

  if (strcmp(argv[1], "session") == 0) {
    return command_session(argc, argv);
  }

  fprintf(stderr, "unknown command: %s\n", argv[1]);
  return 2;
}
