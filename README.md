## niimblue-node [![NPM](https://img.shields.io/npm/v/@mmote/niimblue-node)](https://npmjs.com/package/@mmote/niimblue-node)

[niimbluelib](https://github.com/MultiMote/niimbluelib) BLE and serial client implementations for non-browser use cases.

Command line interface, simple REST server are also included.

Tested with:

Windows:

* Windows 10
* Bluetooth adapter (TP-LINK UB500)
* USB serial connection
* Printers: B1, D110, B21_C2B, B21_PRO

Mac:

* macOS 15.5
* Integrated Bluetooth adapter
* Printer: D110

[Protocol tested with these models (niimbluelib repo)](https://github.com/MultiMote/niimbluelib/issues/1).

Usage example:

* [src/service.ts](src/service.ts)

### Install

Global (for cli usage):

```bash
npm i -g @mmote/niimblue-node
```

[node-gyp](https://www.npmjs.com/package/node-gyp) is required to install [noble](https://www.npmjs.com/package/@mmote/niimblue-node) dependency.
It requires working compiler installed on your system.

Windows requirements:

* [MS Build tools 2019+](https://visualstudio.microsoft.com/downloads/?q=build+tools)
  - C++ build tools with `Windows SDK >=22000` must be installed
* Python 3

Mac requirements:

* [Xcode](https://apps.apple.com/ca/app/xcode/id497799835)
* Permissions: Open "System Settings" → "Privacy & Security" → "Bluetooth" and then add your terminal to allowed applications.

See [node-gyp](https://github.com/nodejs/node-gyp) and [noble](https://github.com/abandonware/noble) installation.

### Command-line usage

While development:

```bash
npm run cli --- <options>
```

If installed as package globally:

```bash
niimblue-cli <options>
```

Available options:

```bash
niimblue-cli help print
niimblue-cli help print-grayscale
niimblue-cli help info
niimblue-cli help scan
niimblue-cli help server
niimblue-cli help flash
```

#### Examples

B1 BLE:

```bash
niimblue-cli print -d -t ble -a 27:03:07:17:6e:82 -p B1 -o top label_15x30.png
```

D110 BLE:

```bash
niimblue-cli print -d -t ble -a 26:03:03:c3:f9:11 -p D110 -o left label_15x30.png
```

D110 BLE via name:

_Connecting via the Bluetooth device name instead of address is required on macOS. Find the device name with `niimblue-cli scan -t ble`._

```bash
niimblue-cli print -d -t ble -a 'D110-XXXXXXXXXX' -p D110 -o left -w 192 -h 96 label_15x30.png
```

B1 serial, long parameter names (will resize image to fit 50x30 label, keeping aspect ratio):

```bash
niimblue-cli print --debug --transport serial --address COM8 --print-task B1 --print-direction top --label-width 384 --label-height 240 label_15x30.png
```

B21_PRO BLE, long parameter names (will resize image to fit 50x30 300dpi label, don't keep aspect ratio):

```bash
niimblue-cli print --debug --transport ble --address c3:16:13:04:06:18 --print-task D110M_V4 --print-direction top --label-width 584 --label-height 354 --image-fit fill label_15x30.png
```

B1 Pro grayscale via serial (4-bit grayscale, tested with a 54x80 thermal roll):

_The `print-grayscale` command uses 4-bit grayscale and the `D110M_V4_GRAYSCALE` print task, and pads the image to a 576px row stride for the B1 Pro. Unlike `print`, there is no `-p/--print-task` option. Note that `-q` is print **density** (darkness, default 3), not quantity — quantity is `-n`._

```bash
niimblue-cli print-grayscale -d -t serial -a COM8 -o top -l 2 -q 3 -w 560 -h 944 image.png
```

You can brighten or adjust the source image before printing with `-b/--brightness`, `-c/--contrast` and `-g/--gamma` (`1.0` means no change). Brightness/gamma `<1` darkens and `>1` lightens; contrast `<1` flattens and `>1` punches up midtones. Gamma is limited to `1.0–3.0` (higher lightens midtones, useful to compensate for dark thermal output):

```bash
niimblue-cli print-grayscale -d -t serial -a COM8 -o top -l 2 -q 3 -w 560 -h 944 -b 1.2 -c 1.4 -g 2.2 image.png
```

To check what those adjustments will look like **before** printing, add `--preview`. It writes the transformed image to disk and exits without connecting to the printer (no `-t`/`-a` needed). The default output is `<name>_preview.png` next to the source; pass `--preview-out <path>` to write elsewhere — handy for comparing several settings side by side:

```bash
niimblue-cli print-grayscale --preview -b 1.2 -c 1.4 -g 2.2 image.png           # -> image_preview.png
niimblue-cli print-grayscale --preview --preview-out bright.png -b 1.5 image.png
```

`--preview` works for the B&W `print` command too (it shows the thresholded 1-bit result): `niimblue-cli print --preview -x 100 label.png`.

B1 firmware upgrade via serial:

```bash
niimblue-cli flash -t serial -a COM8 -n 5.14 -f path/to/B1_5.14.bin
```

### Server mode

You can start a simple server with:

```bash
niimblue-cli server
```

Enable debug logging, set host and port, enable CORS:

```bash
niimblue-cli server -d -h 0.0.0.0 -p 5000 --cors
```

See [sharp docs](https://sharp.pixelplumbing.com/api-resize/) for image resize options.

[Server API docs](https://niimnode-docs.pages.dev/server/)
