import React from "react";
import clsx from "clsx";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import styles from "./index.module.css";

function HeroBanner() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx("hero hero--primary", styles.heroBanner)}>
      <div className="container">
        <h1 className="hero__title">{siteConfig.title}</h1>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/getting-started/installation"
          >
            Get Started
          </Link>
        </div>
        <div className={styles.heroImage}>
          <img src="/img/screenshots/dashboard.png" alt="LoadFlux Dashboard" />
        </div>
      </div>
    </header>
  );
}

const features = [
  {
    title: "Zero Config",
    description:
      "Add one line of code and get a full monitoring dashboard. SQLite database included no external services needed.",
  },
  {
    title: "Embedded Dashboard",
    description:
      "A Grafana-like React dashboard served on the same server. Monitor CPU, RAM, API latencies, error rates, and more.",
  },
  {
    title: "Framework Support",
    description:
      "Works with Express, Fastify, and NestJS. Drop-in middleware with sub-millisecond overhead on the hot path.",
  },
];

function Feature({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className={clsx("col col--4")}>
      <div className="text--center padding-horiz--md padding-vert--lg">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function Home(): React.ReactElement {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout title="Home" description={siteConfig.tagline}>
      <HeroBanner />
      <main>
        <section className={styles.features}>
          <div className="container">
            <div className="row">
              {features.map((props, idx) => (
                <Feature key={idx} {...props} />
              ))}
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
