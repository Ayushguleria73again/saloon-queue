import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SalonFlow — Salon Queue Management",
    short_name: "SalonFlow",
    description: "Digital QR queue management, live token tracking, and Web Push alerts for modern salons.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0A0D14",
    theme_color: "#0A0D14",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "192x192 512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
