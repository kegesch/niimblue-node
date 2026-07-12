import { D110MV4GrayscalePrintTask, LabelType, NiimbotAbstractClient, PrintDirection, PrintTaskName, printTaskNames } from "@mmote/niimbluelib";
import { IncomingMessage } from "http";
import sharp from "sharp";
import { z } from "zod";
import { NiimbotHeadlessBleClient } from "../client/headless_ble_impl";
import { NiimbotHeadlessSerialClient } from "../client/headless_serial_impl";
import { ImageEncoder } from "../image_encoder";
import { applyAutoTone, AutoToneMode } from "../image_processing";
import { initClient, loadImageFromBase64, loadImageFromUrl, printImage } from "../utils";
import { readBodyJson, RestError } from "./simple_server";

let client: NiimbotAbstractClient | null = null;
let debug: boolean = false;

const ConnectSchema = z.object({
  transport: z.enum(["serial", "ble"]),
  address: z.string(),
});

const ScanSchema = z.object({
  transport: z.enum(["serial", "ble"]),
  timeout: z.number().default(5000),
});

const [firstTask, ...otherTasks] = printTaskNames;

const imageSourceRefine = ({ imageUrl, imageBase64 }: { imageUrl?: string; imageBase64?: string }) =>
  !!imageUrl !== !!imageBase64;

const imageSourceRefineMessage = {
  message: "imageUrl or imageBase64 must be defined",
  path: ["image"],
};

const PrintSchema = z
  .object({
    printDirection: z.enum(["left", "top"]).optional(),
    printTask: z.enum([firstTask, ...otherTasks]).optional(),
    quantity: z.number().min(1).default(1),
    labelType: z.number().min(1).default(LabelType.WithGaps),
    density: z.number().min(1).default(3),
    imageBase64: z.string().optional(),
    imageUrl: z.string().optional(),
    labelWidth: z.number().positive().optional(),
    labelHeight: z.number().positive().optional(),
    threshold: z.number().min(1).max(255).default(128),
    imagePosition: z
      .enum(["centre", "top", "right top", "right", "right bottom", "bottom", "left bottom", "left", "left top"])
      .default("centre"),
    imageFit: z.enum(["contain", "cover", "fill", "inside", "outside"]).default("contain"),
    autoTone: z.enum(["stretch", "gaussian", "equalize", "gamma-mean"] as [AutoToneMode, ...AutoToneMode[]]).optional(),
  })
  .refine(imageSourceRefine, imageSourceRefineMessage);

const GrayscalePrintSchema = z
  .object({
    printDirection: z.enum(["left", "top"]).optional(),
    quantity: z.number().min(1).default(1),
    labelType: z.number().min(1).default(LabelType.WithGaps),
    density: z.number().min(1).default(3),
    imageBase64: z.string().optional(),
    imageUrl: z.string().optional(),
    labelWidth: z.number().positive().optional(),
    labelHeight: z.number().positive().optional(),
    imagePosition: z
      .enum(["centre", "top", "right top", "right", "right bottom", "bottom", "left bottom", "left", "left top"])
      .default("centre"),
    imageFit: z.enum(["contain", "cover", "fill", "inside", "outside"]).default("contain"),
    brightness: z.number().positive().optional(),
    contrast: z.number().positive().optional(),
    gamma: z.number().min(1).max(3).optional(),
    autoTone: z.enum(["stretch", "gaussian", "equalize", "gamma-mean"] as [AutoToneMode, ...AutoToneMode[]]).optional(),
  })
  .refine(imageSourceRefine, imageSourceRefineMessage);

export const setDebug = (v: boolean): void => {
  debug = v;
};

const assertConnected = () => {
  if (!client?.isConnected()) {
    throw new RestError("Not connected", 400);
  }
};

export const index = () => ({ message: "Server is working" });

export const connect = async (r: IncomingMessage) => {
  const data = await readBodyJson(r, ConnectSchema);

  if (client?.isConnected()) {
    throw new RestError("Already connected", 400);
  }

  client = initClient(data.transport, data.address, debug);
  await client.connect();

  return { message: "Connected" };
};

export const disconnect = async () => {
  assertConnected();

  await client!.disconnect();
  client = null;
  return { message: "Disconnected" };
};

export const connected = async () => {
  return { connected: !!client?.isConnected() };
};

export const info = async () => {
  assertConnected();

  return {
    printerInfo: client!.getPrinterInfo(),
    modelMetadata: client!.getModelMetadata(),
    detectedPrintTask: client!.getPrintTaskType(),
  };
};

const loadImageFromOptions = async (
  options: { imageBase64?: string; imageUrl?: string }
): Promise<sharp.Sharp> => {
  if (options.imageBase64 !== undefined) {
    return loadImageFromBase64(options.imageBase64);
  }
  if (options.imageUrl !== undefined) {
    return loadImageFromUrl(options.imageUrl);
  }
  throw new RestError("Image is not defined", 400);
};

const applyManualGrayscaleAdjustments = (
  image: sharp.Sharp,
  options: { brightness?: number; contrast?: number; gamma?: number }
): sharp.Sharp => {
  if (options.brightness !== undefined) {
    image = image.modulate({ brightness: options.brightness });
  }
  if (options.contrast !== undefined) {
    const c = options.contrast;
    image = image.linear(c, 128 * (1 - c));
  }
  if (options.gamma !== undefined) {
    image = image.gamma(1, options.gamma);
  }
  return image;
};

export const print = async (r: IncomingMessage) => {
  assertConnected();

  const options = await readBodyJson(r, PrintSchema);

  let image = await loadImageFromOptions(options);

  image = image.flatten({ background: "#fff" });

  if (options.autoTone !== undefined) {
    image = await applyAutoTone(image, options.autoTone);
  }

  if (options.labelWidth !== undefined && options.labelHeight !== undefined) {
    image = image.resize(options.labelWidth, options.labelHeight, {
      kernel: sharp.kernel.nearest,
      fit: options.imageFit,
      position: options.imagePosition,
      background: "#fff",
    });
  }

  image = image.threshold(options.threshold);

  // await image.toFile("tmp.png");

  const printDirection: PrintDirection | undefined = options.printDirection ?? client!.getModelMetadata()?.printDirection;
  const printTask: PrintTaskName | undefined = options.printTask ?? client!.getPrintTaskType();

  const encoded = await ImageEncoder.encodeImage(image, printDirection);

  if (printTask === undefined) {
    throw new RestError("Unable to detect print task, please set it manually", 400);
  }

  if (debug) {
    console.log("Print task:", printTask);
  }

  await printImage(client!, printTask, encoded, {
    quantity: options.quantity,
    labelType: options.labelType,
    density: options.density,
  });

  return { message: "Printed" };
};

export const printGrayscale = async (r: IncomingMessage) => {
  assertConnected();

  const options = await readBodyJson(r, GrayscalePrintSchema);

  let image = await loadImageFromOptions(options);

  image = image.flatten({ background: "#fff" });

  if (options.autoTone !== undefined) {
    image = await applyAutoTone(image, options.autoTone);
  }

  image = applyManualGrayscaleAdjustments(image, options);

  if (options.labelWidth !== undefined && options.labelHeight !== undefined) {
    image = image.resize(options.labelWidth, options.labelHeight, {
      kernel: sharp.kernel.nearest,
      fit: options.imageFit,
      position: options.imagePosition,
      background: "#fff",
    });
  }

  const printDirection: PrintDirection | undefined = options.printDirection ?? client!.getModelMetadata()?.printDirection;

  // Match the B1 Pro 576px row stride used by the CLI grayscale path.
  const padToWidth = 576;

  if (debug) {
    console.log("Grayscale padToWidth:", padToWidth, "stride:", Math.ceil(padToWidth / 2));
  }

  const encoded = await ImageEncoder.encodeImageGrayscale(image, printDirection, padToWidth);

  if (debug) {
    console.log("Encoded grayscale:", encoded.cols, "x", encoded.rows, "data length:", encoded.data.length);
  }

  const printTask = client!.abstraction.newPrintTask("D110M_V4_GRAYSCALE", {
    density: options.density,
    labelType: options.labelType,
    totalPages: options.quantity,
    statusPollIntervalMs: 500,
    statusTimeoutMs: 8_000,
  }) as D110MV4GrayscalePrintTask;

  try {
    await printTask.printInit();
    await printTask.printPageGrayscale(encoded, options.quantity);
    await printTask.waitForFinished();
  } finally {
    await printTask.printEnd();
  }

  return { message: "Printed" };
};

export const scan = async (r: IncomingMessage) => {
  const options = await readBodyJson(r, ScanSchema);

  if (options.transport === "ble") {
    return { devices: await NiimbotHeadlessBleClient.scan(options.timeout) };
  } else if (options.transport === "serial") {
    return { devices: await NiimbotHeadlessSerialClient.scan() };
  }

  throw new RestError("Invalid transport", 400);
};
