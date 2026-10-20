import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PMV System",
    short_name: "PMV System",
    description: "Workflow System for PMV",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      {
        src: "/ahmadiah.ico",
        sizes: "256x256",
        type: "image/x-icon",
        purpose: "any",
      },
    ],
  };
}