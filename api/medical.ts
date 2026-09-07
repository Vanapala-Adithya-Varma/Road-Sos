import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

export interface AiMedicalAnalysis { condition: string; severity: "CRITICAL" | "HIGH" | "MODERATE" | "MILD"; possibleDiseasesOrInjuries: string[]; firstAidInstructions: string[]; specialtiesNeeded: string[]; triageSummary: string; }
/** A destination is shown only when returned by a configured data provider. */
export interface RecommendedHospital { id: string; name: string; address?: string; distanceKm: number; phone?: string; lat: number; lng: number; rating?: number; userRatingCount?: number; recommendationReason: string; mapsUrl: string; source: "google" | "geoapify"; verified: true; }
export interface MedicalAnalysisResult { analysis: AiMedicalAnalysis; recommendedHospitals: RecommendedHospital[]; primaryHospital: RecommendedHospital | null; }
const googlePlace = z.object({ id: z.string().optional(), displayName: z.object({ text: z.string() }).optional(), formattedAddress: z.string().optional(), location: z.object({ latitude: z.number(), longitude: z.number() }), nationalPhoneNumber: z.string().optional(), internationalPhoneNumber: z.string().optional(), rating: z.number().optional(), userRatingCount: z.number().optional() });
type RawHospital = Omit<RecommendedHospital, "distanceKm" | "recommendationReason" | "mapsUrl">;
const timeoutFetch = (url: string, init?: RequestInit) => fetch(url, { ...init, signal: AbortSignal.timeout(8_000) });

export function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number) { const dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180; const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2; return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10; }

/** Never invent a facility, coordinates, phone number, rating, or availability. */
export async function fetchNearbyHospitals(lat: number, lng: number, radiusM = 10_000): Promise<RawHospital[]> {
  const googleKey = process.env.GOOGLE_MAPS_PLATFORM_KEY;
  if (googleKey) try {
    const response = await timeoutFetch("https://places.googleapis.com/v1/places:searchNearby", { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": googleKey, "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.nationalPhoneNumber,places.internationalPhoneNumber,places.rating,places.userRatingCount" }, body: JSON.stringify({ includedTypes: ["hospital"], maxResultCount: 8, locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } } }) });
    const data: unknown = await response.json(); const places = z.object({ places: z.array(googlePlace).optional() }).safeParse(data).data?.places ?? [];
    const verified = places.filter(p => p.displayName?.text && p.location).map(p => ({ id: p.id ?? `${p.location.latitude},${p.location.longitude}`, name: p.displayName!.text, address: p.formattedAddress, lat: p.location.latitude, lng: p.location.longitude, phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber, rating: p.rating, userRatingCount: p.userRatingCount, source: "google" as const, verified: true as const }));
    if (verified.length) return verified;
  } catch { /* try the secondary verified provider */ }
  const geoKey = process.env.GEOAPIFY_API_KEY;
  if (geoKey) try {
    const response = await timeoutFetch(`https://api.geoapify.com/v2/places?categories=healthcare.hospital&filter=circle:${lng},${lat},${radiusM}&limit=8&apiKey=${encodeURIComponent(geoKey)}`);
    const data = await response.json() as { features?: Array<{ properties?: { name?: string; formatted?: string; contact?: { phone?: string } }; geometry?: { coordinates?: [number, number] } }> };
    return (data.features ?? []).flatMap((f, index) => { const coordinates = f.geometry?.coordinates; const longitude = coordinates?.[0], latitude = coordinates?.[1], name = f.properties?.name; return name && typeof latitude === "number" && typeof longitude === "number" && Number.isFinite(latitude) && Number.isFinite(longitude) ? [{ id: `geoapify-${index}-${latitude},${longitude}`, name, address: f.properties?.formatted, lat: latitude, lng: longitude, phone: f.properties?.contact?.phone, source: "geoapify" as const, verified: true as const }] : []; });
  } catch { /* no verified provider result */ }
  return [];
}

export function getLocalClinicalFallback(): AiMedicalAnalysis { return { condition: "Emergency concern reported", severity: "HIGH", possibleDiseasesOrInjuries: [], firstAidInstructions: ["Move to a safe location if possible.", "If symptoms are severe, worsening, or life-threatening, call 112 immediately.", "Do not move someone with possible neck or spine injury unless there is immediate danger."], specialtiesNeeded: ["Emergency care"], triageSummary: "This is AI-generated general guidance, not a diagnosis. Seek emergency care now if there is immediate danger." }; }

export async function analyzeMedicalConditionAndRecommendHospitals(params: { patient: { name?: string; bloodGroup?: string; allergies?: string; conditions?: string }; reason: string; sensorSummary?: Record<string, unknown>; location?: { lat: number; lng: number } }): Promise<MedicalAnalysisResult> {
  const hospitals = params.location ? await fetchNearbyHospitals(params.location.lat, params.location.lng) : [];
  const withDistance = hospitals.map(h => ({ ...h, distanceKm: calculateDistanceKm(params.location!.lat, params.location!.lng, h.lat, h.lng), recommendationReason: "Verified provider result; availability and emergency-department capacity are not confirmed.", mapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lng}` })).sort((a, b) => a.distanceKm - b.distanceKm);
  let analysis = getLocalClinicalFallback();
  if (process.env.GEMINI_API_KEY) try { const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }); const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: `You are an AI emergency guidance assistant, not a doctor. Give concise general safety advice for: ${params.reason}. Never diagnose. Always advise calling 112 for severe, worsening, or life-threatening symptoms. Return JSON with condition, severity, possibleDiseasesOrInjuries, firstAidInstructions, specialtiesNeeded, triageSummary.`, config: { temperature: 0, maxOutputTokens: 350 } }); const parsed = JSON.parse((response.text ?? "").replace(/```(?:json)?|```/g, "").trim()) as Partial<AiMedicalAnalysis>; if (parsed.condition && Array.isArray(parsed.firstAidInstructions)) analysis = { ...getLocalClinicalFallback(), ...parsed, severity: ["CRITICAL", "HIGH", "MODERATE", "MILD"].includes(parsed.severity ?? "") ? parsed.severity as AiMedicalAnalysis["severity"] : "HIGH" }; } catch { /* conservative local guidance is safer than provider error text */ }
  return { analysis, recommendedHospitals: withDistance, primaryHospital: withDistance[0] ?? null };
}
