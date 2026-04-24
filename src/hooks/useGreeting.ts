"use client";

import { useEffect, useState } from "react";

interface Greeting {
  text: string;
  emoji: string;
}

/**
 * Returns a time-of-day greeting based on user's local time.
 * Updates every minute in case user crosses time boundary.
 */
export function useGreeting(name?: string): Greeting {
  const [greeting, setGreeting] = useState<Greeting>(() =>
    computeGreeting(name),
  );

  useEffect(() => {
    // Update every minute
    const interval = setInterval(() => {
      setGreeting(computeGreeting(name));
    }, 60 * 1000);

    return () => clearInterval(interval);
  }, [name]);

  return greeting;
}

function computeGreeting(name?: string): Greeting {
  const hour = new Date().getHours();
  const suffix = name ? `, ${name}` : "";

  if (hour < 5) return { text: `Good night${suffix}`, emoji: "🌙" };
  if (hour < 12) return { text: `Good morning${suffix}`, emoji: "☀️" };
  if (hour < 17) return { text: `Good afternoon${suffix}`, emoji: "🌤️" };
  if (hour < 21) return { text: `Good evening${suffix}`, emoji: "🌅" };
  return { text: `Good night${suffix}`, emoji: "🌙" };
}
