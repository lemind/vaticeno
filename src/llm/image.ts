// One generated image (spec 005 FR-024): the event poster. Outside the JSON client because it returns bytes, not a
// schema; the caller records its cost and treats any failure as no image.
import { GoogleGenAI } from '@google/genai';
import type { CallCost } from './client.js';
import { IMAGE_MODEL, IMAGE_USD } from './prices.js';

export async function generateImage(
  apiKey: string,
  prompt: string,
): Promise<{ png: Buffer; costs: CallCost[] }> {
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 60_000 } });
  const res = await ai.models.generateContent({
    model: IMAGE_MODEL,
    contents: prompt,
    config: { imageConfig: { aspectRatio: '16:9' } },
  });
  const costs: CallCost[] = [
    { provider: 'gemini', operation: 'feed_model', units: 1, usdCost: IMAGE_USD },
  ];
  const data = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
    ?.inlineData?.data;
  if (!data) throw Object.assign(new Error('no image in the answer'), { costs });
  return { png: Buffer.from(data, 'base64'), costs };
}
