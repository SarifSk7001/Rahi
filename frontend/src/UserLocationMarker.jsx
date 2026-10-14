import { useEffect, useRef, useState } from "react";
import { Marker, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import "./UserLocationMarker.css";

const blueDotIcon = L.divIcon({
  className: "user-location-icon",
  html: '<div class="user-dot-pulse"></div><div class="user-dot"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

export default function UserLocationMarker({ onLocation }) {
  const map = useMap();
  const [position, setPosition] = useState(null);
  const [accuracy, setAccuracy] = useState(0);
  const centered = useRef(false);

  // Keep the latest callback in a ref so the GPS watch below is started once,
  // even if the parent passes a new inline function on every render.
  const onLocationRef = useRef(onLocation);
  useEffect(() => {
    onLocationRef.current = onLocation;
  }, [onLocation]);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      console.warn("Geolocation is not supported by this browser.");
      return undefined;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy: acc } = pos.coords;
        const latlng = [latitude, longitude];
        setPosition(latlng);
        setAccuracy(acc);

        if (onLocationRef.current) {
          onLocationRef.current({ lat: latitude, lng: longitude });
        }

        // Fly to the user only on the first location fix
        if (!centered.current) {
          map.flyTo(latlng, 16);
          centered.current = true;
        }
      },
      (err) => console.warn("Location error:", err.message),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [map]);

  if (!position) return null;

  return (
    <>
      <Circle
        center={position}
        radius={accuracy}
        pathOptions={{
          color: "#1a73e8",
          weight: 1,
          fillColor: "#1a73e8",
          fillOpacity: 0.12,
        }}
      />
      <Marker position={position} icon={blueDotIcon} interactive={false} />
    </>
  );
}
