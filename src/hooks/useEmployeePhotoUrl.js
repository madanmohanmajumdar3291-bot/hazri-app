import { useEffect, useState } from 'react';
import { getEmployeePhotoUrl } from '../services/employeeService';

// Resolves an employee's stored photo reference to a signed URL the Image
// component can load; null while loading or when there is no photo.
export function useEmployeePhotoUrl(photoUrl) {
  const [uri, setUri] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setUri(null);
    if (!photoUrl) return undefined;
    getEmployeePhotoUrl(photoUrl)
      .then((url) => {
        if (!cancelled) setUri(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [photoUrl]);

  return uri;
}
