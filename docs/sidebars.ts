import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docsSidebar: [
    "intro",
    {
      type: "category",
      label: "Getting Started",
      items: [
        "getting-started/installation",
        "getting-started/express-setup",
        "getting-started/fastify-setup",
        "getting-started/nestjs-setup",
      ],
    },
    {
      type: "category",
      label: "Configuration",
      items: [
        "configuration/options",
        "configuration/database",
        "configuration/authentication",
      ],
    },
    {
      type: "category",
      label: "Guides",
      items: [
        "guides/dashboard-overview",
        "guides/monitoring-endpoints",
        "guides/sse-real-time",
      ],
    },
    {
      type: "category",
      label: "API Reference",
      items: [
        "api-reference/types",
        "api-reference/database-adapter",
      ],
    },
  ],
};

export default sidebars;
