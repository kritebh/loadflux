import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const config: Config = {
  title: "LoadFlux",
  tagline: "Lightweight server monitoring dashboard for Node.js",
  favicon: "img/favicon.svg",

  url: "https://loadflux.dev",
  baseUrl: "/",

  organizationName: "kritebh",
  projectName: "loadflux",

  onBrokenLinks: "throw",

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
      onBrokenMarkdownImages: "warn",
    },
  },

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  themes: [
    [
      require.resolve("@easyops-cn/docusaurus-search-local"),
      {
        hashed: true,
        indexDocs: true,
        indexBlog: false,
        indexPages: true,
        searchBarShortcutKeymap: "mod+k",
      },
    ],
  ],

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          editUrl: "https://github.com/kritebh/loadflux/tree/main/docs/",
        },
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    navbar: {
      title: "LoadFlux",
      logo: {
        alt: "LoadFlux Logo",
        src: "img/logo.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "docsSidebar",
          position: "left",
          label: "Docs",
        },
        {
          href: "https://github.com/kritebh/loadflux",
          label: "GitHub",
          position: "right",
        },
        {
          href: "https://www.npmjs.com/package/loadflux",
          label: "npm",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            {
              label: "Getting Started",
              to: "/docs/getting-started/installation",
            },
            { label: "Configuration", to: "/docs/configuration/options" },
            { label: "Guides", to: "/docs/guides/dashboard-overview" },
          ],
        },
        {
          title: "More",
          items: [
            { label: "GitHub", href: "https://github.com/kritebh/loadflux" },
            { label: "npm", href: "https://www.npmjs.com/package/loadflux" },
          ],
        },
      ],
      copyright: `© ${new Date().getFullYear()} LoadFlux.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash", "json"],
    },
    colorMode: {
      defaultMode: "dark",
      respectPrefersColorScheme: true,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
