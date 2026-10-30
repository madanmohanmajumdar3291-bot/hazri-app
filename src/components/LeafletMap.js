import React, { useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { WebView } from 'react-native-webview';

// A plain Leaflet map served from OpenStreetMap tiles inside a WebView —
// no Google Maps API key required (unlike react-native-maps on a standalone
// Android build, which silently fails without one). `markers` and
// `circles`/`polyline` are plain JS objects passed in as a JSON blob and
// rendered via a small inline script; no native map SDK involved at all.
//
// When `interactive` is true, tapping anywhere on the map drops/moves a
// single pin and reports the coordinate back via `onLocationSelect` — this
// is what lets an admin place a site without physically standing there.
export default function LeafletMap({
  style,
  center,
  zoom = 14,
  markers = [],
  circles = [],
  polyline = null,
  interactive = false,
  pin = null,
  onLocationSelect,
}) {
  const webviewRef = useRef(null);

  const html = useMemo(() => {
    const payload = JSON.stringify({ center, zoom, markers, circles, polyline, interactive, pin });
    return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; background: #eee; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    var data = ${payload};
    var map = L.map('map', { zoomControl: true, attributionControl: false }).setView([data.center.latitude, data.center.longitude], data.zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

    (data.circles || []).forEach(function (c) {
      L.circle([c.latitude, c.longitude], { radius: c.radius, color: c.color || '#1B4B43', fillOpacity: 0.12 }).addTo(map);
    });

    (data.markers || []).forEach(function (m) {
      var marker = L.circleMarker([m.latitude, m.longitude], {
        radius: 8,
        color: '#fff',
        weight: 2,
        fillColor: m.color || '#1B4B43',
        fillOpacity: 1,
      }).addTo(map);
      if (m.label) marker.bindPopup(m.label);
    });

    if (data.polyline && data.polyline.length > 1) {
      var latlngs = data.polyline.map(function (p) { return [p.latitude, p.longitude]; });
      L.polyline(latlngs, { color: '#1B4B43', weight: 4 }).addTo(map);
      L.circleMarker(latlngs[0], { radius: 7, color: '#fff', weight: 2, fillColor: '#2F9E44', fillOpacity: 1 }).addTo(map).bindPopup('Start');
      L.circleMarker(latlngs[latlngs.length - 1], { radius: 7, color: '#fff', weight: 2, fillColor: '#D64545', fillOpacity: 1 }).addTo(map).bindPopup('Latest');
      map.fitBounds(latlngs, { padding: [24, 24] });
    }

    function post(msg) {
      var text = JSON.stringify(msg);
      if (window.ReactNativeWebView) { window.ReactNativeWebView.postMessage(text); }
      else if (window.parent) { window.parent.postMessage(text, '*'); }
    }

    var pinMarker = null;
    function setPin(lat, lng) {
      if (pinMarker) { pinMarker.setLatLng([lat, lng]); }
      else {
        pinMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
        pinMarker.on('dragend', function () {
          var p = pinMarker.getLatLng();
          post({ type: 'location', latitude: p.lat, longitude: p.lng });
        });
      }
    }

    if (data.pin) { setPin(data.pin.latitude, data.pin.longitude); }

    if (data.interactive) {
      map.on('click', function (e) {
        setPin(e.latlng.lat, e.latlng.lng);
        post({ type: 'location', latitude: e.latlng.lat, longitude: e.latlng.lng });
      });
    }
  </script>
</body>
</html>`;
  }, [center, zoom, markers, circles, polyline, interactive, pin]);

  function handleRawMessage(text) {
    try {
      const data = JSON.parse(text);
      if (data.type === 'location' && onLocationSelect) {
        onLocationSelect({ latitude: data.latitude, longitude: data.longitude });
      }
    } catch (_e) {
      // ignore malformed messages
    }
  }

  useEffect(() => {
    if (Platform.OS !== 'web' || !interactive) return;
    function onWindowMessage(event) {
      if (typeof event.data === 'string') handleRawMessage(event.data);
    }
    window.addEventListener('message', onWindowMessage);
    return () => window.removeEventListener('message', onWindowMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive]);

  if (Platform.OS === 'web') {
    // react-native-webview has no reliable web target inside Expo web —
    // render the same HTML in a plain iframe instead.
    return (
      <View style={[styles.container, style]}>
        <iframe title="map" srcDoc={html} style={{ width: '100%', height: '100%', border: 0 }} />
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webviewRef}
        originWhitelist={['*']}
        source={{ html }}
        style={styles.webview}
        onMessage={(event) => handleRawMessage(event.nativeEvent.data)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
  webview: { flex: 1, backgroundColor: 'transparent' },
});
