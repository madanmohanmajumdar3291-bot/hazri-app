import React from 'react';
import LeafletMap from './LeafletMap';

export default function LiveMapView({ style, initialRegion, sites, locations, colors }) {
  const markers = locations.map((loc) => ({
    latitude: loc.latitude,
    longitude: loc.longitude,
    label: loc.employees?.name ?? 'Unknown',
    color: loc.resolvedWithin === false ? colors.error : colors.success,
  }));

  const circles = sites.map((site) => ({
    latitude: site.latitude,
    longitude: site.longitude,
    radius: site.radius_meters,
    color: colors.accent,
  }));

  return (
    <LeafletMap
      style={style}
      center={{ latitude: initialRegion.latitude, longitude: initialRegion.longitude }}
      zoom={sites.length > 0 || locations.length > 0 ? 14 : 5}
      markers={markers}
      circles={circles}
    />
  );
}
