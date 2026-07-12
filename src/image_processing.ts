import sharp from "sharp";

export type AutoToneMode = "stretch" | "gaussian" | "equalize" | "gamma-mean";

const HIST_SIZE = 256;

const computeHistogram = (data: Uint8Array): Uint32Array => {
  const hist = new Uint32Array(HIST_SIZE);
  for (let i = 0; i < data.length; i++) {
    hist[data[i]]++;
  }
  return hist;
};

const buildNormalizedCDF = (hist: Uint32Array): Float64Array => {
  const cdf = new Float64Array(HIST_SIZE);
  cdf[0] = hist[0];
  for (let i = 1; i < HIST_SIZE; i++) {
    cdf[i] = cdf[i - 1] + hist[i];
  }
  const total = cdf[HIST_SIZE - 1];
  if (total > 0) {
    for (let i = 0; i < HIST_SIZE; i++) {
      cdf[i] /= total;
    }
  }
  return cdf;
};

const percentileFromCDF = (cdf: Float64Array, p: number): number => {
  for (let i = 0; i < HIST_SIZE; i++) {
    if (cdf[i] >= p) {
      return i;
    }
  }
  return HIST_SIZE - 1;
};

const applyLUT = (data: Uint8Array, lut: Uint8Array): Uint8Array => {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = lut[data[i]];
  }
  return out;
};

/**
 * Linear percentile stretch: map the input's low/high percentiles to 0/255.
 * Defaults to 1st and 99th percentile to avoid clipping extreme outliers.
 */
export const applyStretch = (
  data: Uint8Array,
  lowPercentile = 0.01,
  highPercentile = 0.99
): Uint8Array => {
  if (lowPercentile >= highPercentile) {
    throw new Error("lowPercentile must be less than highPercentile");
  }

  const hist = computeHistogram(data);
  const cdf = buildNormalizedCDF(hist);
  const low = percentileFromCDF(cdf, lowPercentile);
  const high = percentileFromCDF(cdf, highPercentile);

  if (high <= low) {
    return new Uint8Array(data);
  }

  const scale = 255 / (high - low);
  const lut = new Uint8Array(HIST_SIZE);
  for (let i = 0; i < HIST_SIZE; i++) {
    const v = Math.round((i - low) * scale);
    lut[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return applyLUT(data, lut);
};

/**
 * Standard histogram equalization: spread the most frequent tonal ranges.
 */
export const applyHistogramEqualization = (data: Uint8Array): Uint8Array => {
  const hist = computeHistogram(data);
  const cdf = buildNormalizedCDF(hist);
  const lut = new Uint8Array(HIST_SIZE);
  for (let i = 0; i < HIST_SIZE; i++) {
    lut[i] = Math.round(cdf[i] * 255);
  }
  return applyLUT(data, lut);
};

/**
 * Histogram matching: remap the input histogram so its cumulative distribution
 * approximates a Gaussian (normal) distribution.
 *
 * @param mean   Center of the target Gaussian (0-255).
 * @param sigma  Spread of the target Gaussian.
 */
export const applyGaussianMatch = (
  data: Uint8Array,
  mean = 128,
  sigma = 48
): Uint8Array => {
  if (sigma <= 0) {
    throw new Error("sigma must be positive");
  }

  const hist = computeHistogram(data);
  const inputCDF = buildNormalizedCDF(hist);

  // Build discretized Gaussian CDF.
  const targetCDF = new Float64Array(HIST_SIZE);
  let sum = 0;
  for (let i = 0; i < HIST_SIZE; i++) {
    const x = (i - mean) / sigma;
    sum += Math.exp(-0.5 * x * x);
    targetCDF[i] = sum;
  }
  for (let i = 0; i < HIST_SIZE; i++) {
    targetCDF[i] /= sum;
  }

  const lut = new Uint8Array(HIST_SIZE);
  let targetIdx = 0;
  for (let i = 0; i < HIST_SIZE; i++) {
    const targetP = inputCDF[i];
    while (targetIdx < HIST_SIZE - 1 && targetCDF[targetIdx + 1] <= targetP) {
      targetIdx++;
    }
    lut[i] = targetIdx;
  }
  return applyLUT(data, lut);
};

/**
 * Compute a gamma correction so the image mean maps to a target midtone.
 * Useful for compensating thermal printers that tend to print darker than
 * the source image appears on screen.
 *
 * @param targetMean Desired mean after correction (0-255).
 */
export const applyGammaFromMean = (
  data: Uint8Array,
  targetMean = 128
): Uint8Array => {
  if (targetMean <= 0 || targetMean >= 255) {
    throw new Error("targetMean must be between 0 and 255");
  }

  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
  }
  const mean = sum / data.length;

  if (mean <= 0 || mean >= 255 || mean === targetMean) {
    return new Uint8Array(data);
  }

  // mean/255 = (targetMean/255) ^ gamma  => solve for gamma
  const gamma = Math.log(targetMean / 255) / Math.log(mean / 255);

  const lut = new Uint8Array(HIST_SIZE);
  for (let i = 0; i < HIST_SIZE; i++) {
    const v = Math.pow(i / 255, gamma) * 255;
    lut[i] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
  }
  return applyLUT(data, lut);
};

/**
 * Apply an automatic tone adjustment to a sharp image instance.
 * The image is converted to grayscale internally, processed, and returned as a
 * new single-channel grayscale sharp instance that can be further chained.
 */
export const applyAutoTone = async (
  image: sharp.Sharp,
  mode: AutoToneMode
): Promise<sharp.Sharp> => {
  const { data, info } = await image
    .clone()
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Avoid mutating the original Buffer's underlying view.
  const input = new Uint8Array(data.buffer, data.byteOffset, data.length);

  let output: Uint8Array;
  switch (mode) {
    case "stretch":
      output = applyStretch(input);
      break;
    case "gaussian":
      output = applyGaussianMatch(input);
      break;
    case "equalize":
      output = applyHistogramEqualization(input);
      break;
    case "gamma-mean":
      output = applyGammaFromMean(input);
      break;
    default:
      throw new Error(`Unknown auto-tone mode: ${mode}`);
  }

  return sharp(output, {
    raw: { width: info.width, height: info.height, channels: 1 },
  });
};
