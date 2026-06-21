import {
  D110MV4GrayscalePrintTask,
  FirmwareProgressEvent,
  LabelType,
  NiimbotAbstractClient,
  PrintDirection,
  PrintTaskName,
} from "@mmote/niimbluelib";
import fs from "fs";
import path from "node:path";
import sharp from "sharp";
import {
  ImageEncoder,
  NiimbotHeadlessBleClient,
  NiimbotHeadlessSerialClient,
} from "..";
import {
  initClient,
  loadImageFromFile,
  printImage,
  TransportType,
} from "../utils";
import { InvalidArgumentError } from "@commander-js/extra-typings";

export type SharpImageFit = "contain" | "cover" | "fill" | "inside" | "outside";
export type SharpImagePosition =
  | "left"
  | "top"
  | "centre"
  | "right top"
  | "right"
  | "right bottom"
  | "bottom"
  | "left bottom"
  | "left top";

export interface TransportOptions {
  transport: TransportType;
  address: string;
}

export interface ScanOptions {
  transport: TransportType;
  timeout: number;
}

export interface InfoOptions {
  transport: TransportType;
  address: string;
  debug: boolean;
}

export interface FirmwareOptions {
  transport: TransportType;
  address: string;
  file: string;
  newVersion: string;
  debug: boolean;
}

export interface PrintOptions {
  printTask?: PrintTaskName;
  printDirection?: PrintDirection;
  quantity: number;
  labelType: LabelType;
  density: number;
  threshold: number;
  rotate?: number;
  labelWidth?: number;
  labelHeight?: number;
  imageFit?: SharpImageFit;
  imagePosition?: SharpImagePosition;
  /** When set, write the transformed image to disk and exit without printing. */
  preview?: boolean;
  /** Custom preview output path (default: <name>_preview.png). */
  previewOut?: string;
  debug: boolean;
}

export interface GrayscalePrintOptions {
  printDirection?: PrintDirection;
  quantity: number;
  labelType: LabelType;
  density: number;
  rotate?: number;
  labelWidth?: number;
  labelHeight?: number;
  imageFit?: SharpImageFit;
  imagePosition?: SharpImagePosition;
  /** Brightness multiplier applied to the source (1.0 = unchanged). */
  brightness?: number;
  /** Contrast multiplier centered at mid-gray (1.0 = unchanged). */
  contrast?: number;
  /** Gamma correction exponent (e.g. 2.2). */
  gamma?: number;
  /** When set, write the transformed image to disk and exit without printing. */
  preview?: boolean;
  /** Custom preview output path (default: <name>_preview.png). */
  previewOut?: string;
  debug: boolean;
}

/**
 * Default preview output path: <source_dir>/<source_name>_preview.png
 */
const defaultPreviewPath = (sourcePath: string): string => {
  const p = path.parse(sourcePath);
  return path.join(p.dir, `${p.name}_preview.png`);
};

/**
 * Writes the transformed image to disk as a PNG so the user can verify
 * brightness/contrast/gamma/threshold/resize settings before committing to a
 * print. `previewPath` optionally overrides the default output location.
 * Returns the path that was written.
 */
const writePreviewImage = async (
  image: sharp.Sharp,
  sourcePath: string,
  previewPath: string | undefined,
): Promise<string> => {
  const outPath =
    typeof previewPath === "string" && previewPath.length > 0
      ? previewPath
      : defaultPreviewPath(sourcePath);
  await image.png().toFile(outPath);
  return outPath;
};

export const cliConnectAndPrintImageFile = async (
  path: string,
  options: PrintOptions & Partial<TransportOptions>,
) => {
  let image: sharp.Sharp = await loadImageFromFile(path);

  if (options.rotate !== undefined) {
    image = image.rotate(options.rotate);
  }

  image = image.flatten({ background: "#fff" }).threshold(options.threshold);

  if (options.labelWidth !== undefined && options.labelHeight !== undefined) {
    image = image.resize(options.labelWidth, options.labelHeight, {
      kernel: sharp.kernel.nearest,
      fit: options.imageFit ?? "contain",
      position: options.imagePosition ?? "centre",
      background: "#fff",
    });
  } else if (
    options.imageFit !== undefined ||
    options.imagePosition !== undefined
  ) {
    throw new InvalidArgumentError("label-width and label-height must be set");
  }

  // Preview mode: write the transformed (thresholded) image to disk, then exit
  // without connecting to or printing on the printer.
  if (options.preview) {
    const outPath = await writePreviewImage(
      image.clone(),
      path,
      options.previewOut,
    );
    console.log(`Preview written to ${outPath} (not printed)`);
    process.exit(0);
  }

  if (options.transport === undefined || options.address === undefined) {
    throw new InvalidArgumentError(
      "--transport and --address are required when not using --preview",
    );
  }

  const client: NiimbotAbstractClient = initClient(
    options.transport,
    options.address,
    options.debug,
  );

  if (options.debug) {
    console.log("Connecting to", options.transport, options.address);
  }

  await client.connect();

  const printDirection: PrintDirection | undefined =
    options.printDirection ?? client.getModelMetadata()?.printDirection;
  const printTask: PrintTaskName | undefined =
    options.printTask ?? client.getPrintTaskType();

  const encoded = await ImageEncoder.encodeImage(image, printDirection);

  if (printTask === undefined) {
    throw new Error("Unable to detect print task, please set it manually");
  }

  if (options.debug) {
    console.log("Print task:", printTask);
  }

  let status = 1;

  try {
    await printImage(client, printTask, encoded, {
      quantity: options.quantity,
      labelType: options.labelType,
      density: options.density,
    });
    status = 0;
  } finally {
    await client.disconnect();
  }

  process.exit(status);
};

export const cliScan = async (options: ScanOptions) => {
  if (options.transport === "ble") {
    const devices = await NiimbotHeadlessBleClient.scan(options.timeout);
    for (const dev of devices) {
      console.log(`${dev.address}: ${dev.name}`);
    }
  } else if (options.transport === "serial") {
    const devices = await NiimbotHeadlessSerialClient.scan();
    for (const dev of devices) {
      console.log(`${dev.address}: ${dev.name}`);
    }
  }

  process.exit(0);
};

export const cliPrinterInfo = async (options: InfoOptions) => {
  const client: NiimbotAbstractClient = initClient(
    options.transport,
    options.address,
    options.debug,
  );
  await client.connect();
  console.log("Printer info:", client.getPrinterInfo());
  console.log("Model metadata:", client.getModelMetadata());
  console.log("Detected print task:", client.getPrintTaskType());
  await client.disconnect();
  process.exit(0);
};

export const cliConnectAndPrintGrayscaleImageFile = async (
  path: string,
  options: GrayscalePrintOptions & Partial<TransportOptions>,
) => {
  let image: sharp.Sharp = await loadImageFromFile(path);

  if (options.rotate !== undefined) {
    image = image.rotate(options.rotate);
  }

  image = image.flatten({ background: "#fff" });

  // Adjust brightness/contrast/gamma of the source before encoding.
  // sharp applies these in a fixed pipeline order (modulate -> linear -> gamma)
  // regardless of where they are chained, so they always act on the pixels.
  if (options.brightness !== undefined) {
    image = image.modulate({ brightness: options.brightness });
  }

  if (options.contrast !== undefined) {
    // Contrast multiplier centered at mid-gray (128 for 8-bit):
    //   output = input * contrast + 128 * (1 - contrast)
    const c = options.contrast;
    image = image.linear(c, 128 * (1 - c));
  }

  if (options.gamma !== undefined) {
    // Two-arg form: gamma(1, g) lightens midtones for g in (1, 3] (useful to
    // compensate for dark thermal output). Single-arg gamma is a no-op round-trip.
    image = image.gamma(1, options.gamma);
  }

  if (
    options.debug &&
    (options.brightness || options.contrast || options.gamma)
  ) {
    console.log(
      "Grayscale adjustments:",
      "brightness=" + (options.brightness ?? "off"),
      "contrast=" + (options.contrast ?? "off"),
      "gamma=" + (options.gamma ?? "off"),
    );
  }

  if (options.labelWidth !== undefined && options.labelHeight !== undefined) {
    image = image.resize(options.labelWidth, options.labelHeight, {
      kernel: sharp.kernel.nearest,
      fit: options.imageFit ?? "contain",
      position: options.imagePosition ?? "centre",
      background: "#fff",
    });
  }

  // Preview mode: write the transformed image to disk, then exit without
  // printing. Converted to grayscale so the preview reflects the luminance the
  // printer will actually output.
  if (options.preview) {
    const outPath = await writePreviewImage(
      image.clone().grayscale(),
      path,
      options.previewOut,
    );
    console.log(`Preview written to ${outPath} (not printed)`);
    process.exit(0);
  }

  if (options.transport === undefined || options.address === undefined) {
    throw new InvalidArgumentError(
      "--transport and --address are required when not using --preview",
    );
  }

  const client: NiimbotAbstractClient = initClient(
    options.transport,
    options.address,
    options.debug,
  );

  if (options.debug) {
    console.log("Connecting to", options.transport, options.address);
  }

  await client.connect();

  const printDirection: PrintDirection | undefined =
    options.printDirection ?? client.getModelMetadata()?.printDirection;

  // Pad grayscale data to match the printer's expected row stride.
  // BLE capture from B1 Pro shows SetPageSize cols=575 with data stride=288 bytes/row (576 pixels).
  // The printhead is 567 pixels but the firmware uses a 576-pixel-wide internal buffer.
  // For now, hardcode padToWidth=576 to match BLE behavior.
  // TODO: derive from printer model metadata if needed for other printers.
  const padToWidth = 576;

  if (options.debug) {
    console.log(
      "Grayscale padToWidth:",
      padToWidth,
      "stride:",
      Math.ceil(padToWidth / 2),
    );
  }

  const encoded = await ImageEncoder.encodeImageGrayscale(
    image,
    printDirection,
    padToWidth,
  );

  if (options.debug) {
    console.log(
      "Encoded grayscale:",
      encoded.cols,
      "x",
      encoded.rows,
      "data length:",
      encoded.data.length,
    );
  }

  const printTask = client.abstraction.newPrintTask("D110M_V4_GRAYSCALE", {
    density: options.density ?? 3,
    labelType: options.labelType ?? LabelType.WithGaps,
    totalPages: options.quantity ?? 1,
    statusPollIntervalMs: 500,
    statusTimeoutMs: 8_000,
  }) as D110MV4GrayscalePrintTask;

  let status = 1;

  try {
    await printTask.printInit();
    await printTask.printPageGrayscale(encoded, options.quantity ?? 1);
    await printTask.waitForFinished();
    status = 0;
  } finally {
    await printTask.printEnd();
    await client.disconnect();
  }

  process.exit(status);
};
export const cliFlashFirmware = async (options: FirmwareOptions) => {
  const data: Uint8Array = fs.readFileSync(options.file);

  const client: NiimbotAbstractClient = initClient(
    options.transport,
    options.address,
    options.debug,
  );
  await client.connect();

  client.stopHeartbeat();

  const listener = (e: FirmwareProgressEvent) => {
    console.log(`Sending ${e.currentChunk}/${e.totalChunks}`);
  };

  client.on("firmwareprogress", listener);

  try {
    console.log("Uploading firmware...");
    await client.abstraction.firmwareUpgrade(data, options.newVersion);
    console.log("Done, printer will shut down");
  } finally {
    client.off("firmwareprogress", listener);
    await client.disconnect();
  }

  process.exit(0);
};
