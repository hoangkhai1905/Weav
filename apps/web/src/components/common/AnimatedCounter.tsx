import { useEffect, useState } from 'react';

interface AnimatedCounterProps {
  value: number;
  duration?: number; // duration in seconds (default 0.8s)
}

export function AnimatedCounter({ value, duration = 0.8 }: AnimatedCounterProps) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let animId: number;
    let startTimestamp: number | null = null;
    const endValue = value;

    const step = (timestamp: number) => {
      if (endValue === 0) {
        setCount(0);
        return;
      }
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / (duration * 1000), 1);
      const easeOutProgress = 1 - Math.pow(2, -10 * progress);
      setCount(Math.floor(easeOutProgress * endValue));

      if (progress < 1) {
        animId = window.requestAnimationFrame(step);
      } else {
        setCount(endValue);
      }
    };

    animId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(animId);
  }, [value, duration]);

  return <>{count}</>;
}
