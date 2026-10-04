{
  "targets": [
    {
      "target_name": "file_promise_drag",
      "sources": ["file_promise_drag.mm"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "xcode_settings": {
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "CLANG_ENABLE_OBJC_ARC": "YES",
        "MACOSX_DEPLOYMENT_TARGET": "11.0"
      },
      "libraries": [
        "-framework AppKit",
        "-framework UniformTypeIdentifiers"
      ]
    }
  ]
}
