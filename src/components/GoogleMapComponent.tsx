import React from "react";
import { APIProvider, AdvancedMarker, Map, Pin } from "@vis.gl/react-google-maps";
import { Building2, MapPin, Phone } from "lucide-react";

interface GoogleMapsViewProps {
  center: { lat: number; lng: number };
  zoom?: number;
  markers?: Array<{ lat: number; lng: number; title: string; color?: string }>;
  showTrafficLayer?: boolean;
  voiceMapQuery?: string;
  hasValidKey?: boolean;
  apiKey?: string;
}

/** Map view deliberately contains no offline/placeholders: emergency data must be verified. */
export const GoogleMapComponent: React.FC<GoogleMapsViewProps> = ({ center, zoom = 13, markers = [], hasValidKey = false, apiKey }) => {
  if (!hasValidKey || !apiKey) return (
    <section className="rounded-2xl border border-slate-700 bg-slate-900 p-5 text-slate-100" role="status">
      <div className="flex items-center gap-3"><Building2 className="text-amber-400" /><div><h2 className="font-bold">Map unavailable</h2><p className="mt-1 text-sm text-slate-300">Verified map and hospital information is unavailable. Do not rely on this screen for emergency destination data.</p></div></div>
      <a className="mt-4 inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 font-bold text-white" href="tel:112"><Phone size={16} /> Call 112</a>
    </section>
  );
  return (
    <div className="h-[300px] overflow-hidden rounded-2xl border border-slate-700" aria-label="Map">
      <APIProvider apiKey={apiKey}>
        <Map defaultCenter={center} defaultZoom={zoom} gestureHandling="greedy" disableDefaultUI>
          <AdvancedMarker position={center} title="Current location"><Pin background="#dc2626" glyphColor="#fff" borderColor="#991b1b" /></AdvancedMarker>
          {markers.map((marker, index) => <AdvancedMarker key={`${marker.lat}-${marker.lng}-${index}`} position={marker} title={marker.title}><Pin background={marker.color ?? "#2563eb"} glyphColor="#fff" /></AdvancedMarker>)}
        </Map>
      </APIProvider>
    </div>
  );
};
