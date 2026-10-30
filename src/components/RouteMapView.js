import React from 'react';
import LeafletMap from './LeafletMap';

export default function RouteMapView({ style, points, colors }) {
  if (!points || points.length === 0) return null;

  return (
    <LeafletMap
      style={style}
      center={{ latitude: points[0].latitude, longitude: points[0].longitude }}
      zoom={15}
      polyline={points.map((p) => ({ latitude: p.latitude, longitude: p.longitude }))}
    />
  );
}
