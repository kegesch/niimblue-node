import {
  InvalidArgumentError,
  Option,
  program,
} from "@commander-js/extra-typings";
import { PrintDirection, printTaskNames } from "@mmote/niimbluelib";
import { AutoToneMode } from "../image_processing";
import { cliStartServer } from "../server";
import { TransportType } from "../utils";
import {
  cliConnectAndPrintGrayscaleImageFile,
  cliConnectAndPrintImageFile,
  cliFlashFirmware,
  cliPrinterInfo,
  cliScan,
  SharpImageFit,
  SharpImagePosition,
} from "./worker";

const intOption = (value: string): number => {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 0) {
    throw new InvalidArgumentError("Integer required");
  }
  return parsed;
};

const positiveFloatOption = (value: string): number => {
  const parsed = parseFloat(value);
  if (isNaN(parsed) || parsed <= 0) {
    throw new InvalidArgumentError("Positive number required");
  }
  return parsed;
};

const gammaOption = (value: string): number => {
  const parsed = parseFloat(value);
  if (isNaN(parsed) || parsed < 1.0 || parsed > 3.0) {
    throw new InvalidArgumentError("Number between 1.0 and 3.0 required");
  }
  return parsed;
};

program.name("niimblue-cli");

program
  .command("info")
  .description("Printer information")
  .requiredOption("-d, --debug", "Debug information", false)
  .addOption(
    new Option("-t, --transport <type>", "Transport")
      .makeOptionMandatory()
      .choices(["ble", "serial"] as TransportType[]),
  )
  .requiredOption(
    "-a, --address <string>",
    "Device bluetooth address/name or serial port name/path",
  )
  .action(cliPrinterInfo);

program
  .command("scan")
  .description("Get available device list")
  .requiredOption("-n, --timeout <number>", "Timeout", intOption, 5000)
  .addOption(
    new Option("-t, --transport <type>", "Transport")
      .makeOptionMandatory()
      .choices(["ble", "serial"] as TransportType[]),
  )
  .action(cliScan);

program
  .command("print")
  .description("Prints image")
  .argument("<path>", "PNG image path")
  .requiredOption("-d, --debug", "Debug information", false)
  .addOption(
    new Option("-t, --transport <type>", "Transport").choices([
      "ble",
      "serial",
    ] as TransportType[]),
  )
  .option(
    "-a, --address <string>",
    "Device bluetooth address/name or serial port name/path",
  )
  .addOption(
    new Option("-o, --print-direction <dir>", "Print direction").choices([
      "left",
      "top",
    ] as PrintDirection[]),
  )
  .addOption(
    new Option("-p, --print-task <type>", "Print task").choices(printTaskNames),
  )
  .requiredOption("-l, --label-type <type number>", "Label type", intOption, 1)
  .requiredOption("-q, --density <number>", "Density", intOption, 3)
  .requiredOption("-n, --quantity <number>", "Quantity", intOption, 1)
  .requiredOption("-x, --threshold <number>", "Threshold", intOption, 128)
  .option("-w, --label-width <number>", "Label width", intOption)
  .option("-h, --label-height <number>", "Label height", intOption)
  .addOption(
    new Option(
      "-f, --image-fit <dir>",
      "Image fit while resizing (label-width and label-height must be set)",
    ).choices([
      "contain",
      "cover",
      "fill",
      "inside",
      "outside",
    ] as SharpImageFit[]),
  )
  .addOption(
    new Option(
      "-m, --image-position <dir>",
      "Image position while resizing (label-width and label-height must be set)",
    ).choices([
      "left",
      "top",
      "centre",
      "right top",
      "right",
      "right bottom",
      "bottom",
      "left bottom",
      "left top",
    ] as SharpImagePosition[]),
  )
  .option("-r, --rotate <angle>", "Rotation angle (90, 180, 270)", intOption)
  .option(
    "--preview",
    "Write the transformed image to disk and exit without printing",
  )
  .option(
    "--preview-out <path>",
    "Preview output path (default: <name>_preview.png)",
  )
  .action(cliConnectAndPrintImageFile);

program
  .command("print-grayscale")
  .description(
    "Prints image in 4-bit grayscale mode (for compatible printers like B1 Pro). " +
      "Uses the D110M_V4_GRAYSCALE print task and pads to a 576px row stride; no --print-task option.",
  )
  .argument("<path>", "Image path")
  .requiredOption("-d, --debug", "Debug information", false)
  .addOption(
    new Option("-t, --transport <type>", "Transport").choices([
      "ble",
      "serial",
    ] as TransportType[]),
  )
  .option(
    "-a, --address <string>",
    "Device bluetooth address/name or serial port name/path",
  )
  .addOption(
    new Option("-o, --print-direction <dir>", "Print direction").choices([
      "left",
      "top",
    ] as PrintDirection[]),
  )
  .requiredOption("-l, --label-type <type number>", "Label type", intOption, 1)
  .requiredOption("-q, --density <number>", "Density", intOption, 3)
  .requiredOption("-n, --quantity <number>", "Quantity", intOption, 1)
  .option("-w, --label-width <number>", "Label width", intOption)
  .option("-h, --label-height <number>", "Label height", intOption)
  .addOption(
    new Option("-f, --image-fit <dir>", "Image fit while resizing").choices([
      "contain",
      "cover",
      "fill",
      "inside",
      "outside",
    ] as SharpImageFit[]),
  )
  .addOption(
    new Option(
      "-m, --image-position <dir>",
      "Image position while resizing",
    ).choices([
      "left",
      "top",
      "centre",
      "right top",
      "right",
      "right bottom",
      "bottom",
      "left bottom",
      "left top",
    ] as SharpImagePosition[]),
  )
  .option("-r, --rotate <angle>", "Rotation angle (90, 180, 270)", intOption)
  .option(
    "-b, --brightness <number>",
    "Brightness multiplier (1.0 = unchanged; <1 darker, >1 lighter)",
    positiveFloatOption,
  )
  .option(
    "-c, --contrast <number>",
    "Contrast multiplier (1.0 = unchanged; <1 lower, >1 higher)",
    positiveFloatOption,
  )
  .option(
    "-g, --gamma <number>",
    "Gamma 1.0-3.0 (1.0 = unchanged; higher lightens midtones)",
    gammaOption,
  )
  .addOption(
    new Option(
      "--auto-tone <mode>",
      "Auto-adjust tone before manual corrections",
    ).choices(["stretch", "gaussian", "equalize", "gamma-mean"] as AutoToneMode[]),
  )
  .option(
    "--preview",
    "Write the transformed image to disk and exit without printing",
  )
  .option(
    "--preview-out <path>",
    "Preview output path (default: <name>_preview.png)",
  )
  .action(cliConnectAndPrintGrayscaleImageFile);

program
  .command("server")
  .description("Start in server mode")
  .requiredOption("-d, --debug", "Debug information", false)
  .requiredOption("-c, --cors", "Enable CORS", false)
  .requiredOption("-p, --port <number>", "Listen port", intOption, 5000)
  .requiredOption("-h, --host <host>", "Listen hostname", "localhost")
  .action(cliStartServer);

program
  .command("flash")
  .description("Flash firmware")
  .requiredOption("-d, --debug", "Debug information", false)
  .addOption(
    new Option("-t, --transport <type>", "Transport")
      .makeOptionMandatory()
      .choices(["ble", "serial"] as TransportType[]),
  )
  .requiredOption(
    "-a, --address <string>",
    "Device bluetooth address/name or serial port name/path",
  )
  .requiredOption("-f, --file <path>", "Firmware path")
  .requiredOption("-n, --new-version <version>", "New firmware version")
  .action(cliFlashFirmware);

program.parse();
