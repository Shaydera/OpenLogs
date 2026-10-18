import { useEffect, useState } from 'react';
import { currentAutoScale } from '../uiScale';

export function useAutoScale(): number {
  const [auto, setAuto] = useState(currentAutoScale);
  useEffect(() => {
    const update = () => setAuto(currentAutoScale());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return auto;
}
