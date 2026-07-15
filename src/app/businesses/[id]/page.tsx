import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getDashboardBusinessById } from "@/lib/dashboard-queries";
import { formatNullable, formatGridRank, formatSeoMetric, formatCurrency } from "@/lib/format";
import { ReviewCountChart } from "@/components/dashboard/review-count-chart";
import { MapRankGrid } from "@/components/dashboard/map-rank-grid";
import { SCORE_MODEL_STATUS } from "@/lib/dashboard-types";

export const dynamic = "force-dynamic";

function Field({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-vezzt-950">{value}</dd>
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const empty = value === "Not calculated" || value === "Not available";
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p
        className={`mt-1 text-base font-semibold ${
          empty ? "text-neutral-400" : "text-vezzt-950"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export default async function BusinessDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const business = await getDashboardBusinessById(id);
  if (!business) notFound();

  const rawInputs: { label: string; value: string }[] = [
    { label: "name", value: business.name },
    { label: "primary_category", value: business.primaryCategory ?? "null" },
    {
      label: "secondary_categories",
      value: business.secondaryCategories?.join(", ") ?? "null",
    },
    { label: "city", value: business.city ?? "null" },
    { label: "state", value: business.state ?? "null" },
    {
      label: "latitude",
      value: business.latitude === null ? "null" : String(business.latitude),
    },
    {
      label: "longitude",
      value: business.longitude === null ? "null" : String(business.longitude),
    },
    {
      label: "review_count (latest)",
      value: business.reviewCount === null ? "null" : String(business.reviewCount),
    },
    {
      label: "average_rating (latest)",
      value:
        business.averageRating === null ? "null" : String(business.averageRating),
    },
    {
      label: "latest_snapshot_date",
      value: business.latestSnapshotDate ?? "null",
    },
    {
      label: "review_threshold_met",
      value: String(business.reviewThresholdMet),
    },
    {
      label: "qualification_status",
      value: business.qualificationStatus,
    },
    {
      label: "qualification_confidence",
      value:
        business.qualificationConfidence === null
          ? "null"
          : String(business.qualificationConfidence),
    },
    {
      label: "target_sector",
      value: business.targetSector ?? "null",
    },
    {
      label: "estimated_annual_revenue",
      value:
        business.estimatedAnnualRevenue === null
          ? "null"
          : String(business.estimatedAnnualRevenue),
    },
    {
      label: "review_velocity_monthly",
      value:
        business.reviewVelocityMonthly === null
          ? "null"
          : String(business.reviewVelocityMonthly),
    },
    {
      label: "employee_count_estimate",
      value:
        business.enrichment?.employeeCountEstimate === null ||
        business.enrichment?.employeeCountEstimate === undefined
          ? "null"
          : String(business.enrichment.employeeCountEstimate),
    },
    {
      label: "founded_year",
      value:
        business.enrichment?.foundedYear === null ||
        business.enrichment?.foundedYear === undefined
          ? "null"
          : String(business.enrichment.foundedYear),
    },
    {
      label: "growth_score (proprietary_scores)",
      value: "null — table missing",
    },
    {
      label: "market_strength (proprietary_scores)",
      value: "null — table missing",
    },
    {
      label: "brand_strength (proprietary_scores)",
      value: "null — table missing",
    },
    {
      label: "map_rank.status",
      value: business.mapRank?.status ?? "null",
    },
    {
      label: "map_rank.error",
      value: business.mapRank?.errorMessage ?? "null",
    },
    {
      label: "map_rank.provider_scan_id",
      value: business.mapRank?.providerScanId ?? "null",
    },
    {
      label: "domain_rating",
      value:
        business.seo?.domainRating === null ||
        business.seo?.domainRating === undefined
          ? "null"
          : String(business.seo.domainRating),
    },
    {
      label: "organic_traffic",
      value:
        business.seo?.organicTraffic === null ||
        business.seo?.organicTraffic === undefined
          ? "null"
          : String(business.seo.organicTraffic),
    },
    {
      label: "organic_keywords",
      value:
        business.seo?.organicKeywords === null ||
        business.seo?.organicKeywords === undefined
          ? "null"
          : String(business.seo.organicKeywords),
    },
    {
      label: "organic_keywords_top3",
      value:
        business.seo?.organicKeywordsTop3 === null ||
        business.seo?.organicKeywordsTop3 === undefined
          ? "null"
          : String(business.seo.organicKeywordsTop3),
    },
    {
      label: "referring_domains",
      value:
        business.seo?.referringDomains === null ||
        business.seo?.referringDomains === undefined
          ? "null"
          : String(business.seo.referringDomains),
    },
    {
      label: "backlinks",
      value:
        business.seo?.backlinks === null ||
        business.seo?.backlinks === undefined
          ? "null"
          : String(business.seo.backlinks),
    },
    {
      label: "traffic_value",
      value:
        business.seo?.trafficValue === null ||
        business.seo?.trafficValue === undefined
          ? "null"
          : String(business.seo.trafficValue),
    },
    {
      label: "company_id",
      value: business.company?.id ?? "null",
    },
    {
      label: "company_name",
      value: business.company?.companyName ?? "null",
    },
    {
      label: "company_type",
      value: business.company?.companyType ?? "null",
    },
    {
      label: "company_scale",
      value: business.company?.companyScale ?? "null",
    },
    {
      label: "ownership_model",
      value: business.company?.ownershipModel ?? "null",
    },
    {
      label: "location_count",
      value:
        business.company?.locationCount === null ||
        business.company?.locationCount === undefined
          ? "null"
          : String(business.company.locationCount),
    },
    {
      label: "classification_confidence",
      value:
        business.company?.classificationConfidence === null ||
        business.company?.classificationConfidence === undefined
          ? "null"
          : String(business.company.classificationConfidence),
    },
    {
      label: "analysis_mode",
      value: business.analysisMode ?? "null",
    },
    {
      label: "analysis_target",
      value: business.analysisTarget ?? "null",
    },
  ];

  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="border-b border-neutral-200 bg-vezzt-950 px-4 py-4 text-white sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-vezzt-300">
              Business detail
            </p>
            <h1 className="text-xl font-semibold tracking-tight">
              {business.name}
            </h1>
            <p className="mt-1 text-sm text-vezzt-200">
              {business.primaryCategory ?? "Uncategorized"}
              {business.city ? ` · ${business.city}` : ""}
              {business.state ? `, ${business.state}` : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/dashboard"
              className="rounded-lg border border-vezzt-700 px-3 py-1.5 text-xs font-medium text-vezzt-100 hover:bg-vezzt-900"
            >
              ← Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-vezzt-950">Identity</h2>
          <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name" value={business.name} />
            <Field
              label="Category"
              value={business.primaryCategory ?? "—"}
            />
            <Field label="Address" value={business.address ?? "—"} />
            <Field label="Phone" value={business.phone ?? "—"} />
            <Field
              label="Website"
              value={
                business.websiteUrl ? (
                  <a
                    href={business.websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-vezzt-600 underline"
                  >
                    {business.websiteUrl}
                  </a>
                ) : (
                  "—"
                )
              }
            />
            <Field
              label="Google Maps"
              value={
                business.googleMapsUrl ? (
                  <a
                    href={business.googleMapsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-vezzt-600 underline"
                  >
                    Open in Google Maps
                  </a>
                ) : (
                  "—"
                )
              }
            />
          </dl>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-vezzt-950">Company</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Brand / legal company ownership. Each Google Place ID remains its own
            business location.
          </p>
          {!business.company ? (
            <p className="mt-4 text-sm text-neutral-500">
              No company linked yet.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field
                  label="Company Name"
                  value={business.company.companyName}
                />
                <Field
                  label="Company Scale"
                  value={business.company.companyScale}
                />
                <Field
                  label="Ownership Model"
                  value={business.company.ownershipModel}
                />
                <Field
                  label="Known Location Count"
                  value={
                    business.company.locationCount === null
                      ? "—"
                      : String(business.company.locationCount)
                  }
                />
                <Field
                  label="Root Domain"
                  value={business.company.rootDomain ?? "—"}
                />
                <Field
                  label="Classification Confidence"
                  value={
                    business.company.classificationConfidence === null
                      ? "—"
                      : String(business.company.classificationConfidence)
                  }
                />
                <Field
                  label="Classification Reason"
                  value={business.company.classificationReason ?? "—"}
                />
                {business.company.classificationIsManual ? (
                  <Field label="Manual Override" value="Yes" />
                ) : null}
              </dl>

              {business.siblingLocations.length > 0 ? (
                <div>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    Other Locations
                  </h3>
                  <ul className="mt-2 divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                    {business.siblingLocations.map((loc) => (
                      <li key={loc.id} className="px-3 py-2 text-sm">
                        <Link
                          href={`/businesses/${loc.id}`}
                          className="font-medium text-vezzt-700 underline-offset-2 hover:underline"
                        >
                          {loc.name}
                        </Link>
                        <span className="text-neutral-500">
                          {loc.city ? ` · ${loc.city}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-vezzt-950">
            Current signals
          </h2>
          <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field
              label="Rating"
              value={formatNullable(business.averageRating, { kind: "rating" })}
            />
            <Field
              label="Review count"
              value={
                business.reviewCount === null
                  ? "—"
                  : business.reviewCount.toLocaleString("en-US")
              }
            />
            <Field
              label="Latest snapshot date"
              value={business.latestSnapshotDate ?? "—"}
            />
            <Field
              label="Review threshold"
              value={
                business.reviewThresholdMet ? "Met" : "Below threshold"
              }
            />
            <Field
              label="Qualification status"
              value={business.qualificationStatus.replace("_", " ")}
            />
            <Field
              label="Qualification reason"
              value={business.qualificationReason ?? "—"}
            />
          </dl>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-vezzt-950">
            Google Maps Visibility
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            Local pack GeoGrid from Local Brand Manager, matched by Google Place
            ID.
          </p>

          {!business.mapRank ? (
            <p className="mt-4 text-sm text-neutral-500">
              No GeoGrid scan stored for this business yet.
            </p>
          ) : business.mapRank.status === "pending" ||
            business.mapRank.status === "processing" ? (
            <p className="mt-4 text-sm font-medium text-amber-800">
              GeoGrid scan in progress.
            </p>
          ) : business.mapRank.status === "failed" ? (
            <div className="mt-4 space-y-2">
              <p className="text-sm font-medium text-red-700">
                GeoGrid scan failed.
              </p>
              <p className="font-mono text-xs text-red-800">
                {business.mapRank.errorMessage ?? "Unknown error"}
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-5">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <Metric
                  label="Share of Local Voice"
                  value={
                    business.mapRank.shareOfLocalVoice === null
                      ? "—"
                      : `${(business.mapRank.shareOfLocalVoice * 100).toFixed(1)}%`
                  }
                />
                <Metric
                  label="Average Grid Rank"
                  value={formatGridRank(business.mapRank.averageGridRank)}
                />
                <Metric
                  label="Average Total Grid Rank"
                  value={formatGridRank(
                    business.mapRank.averageTotalGridRank,
                  )}
                />
                <Metric
                  label="Top 3 coverage"
                  value={
                    business.mapRank.foundInTop3Count === null ||
                    business.mapRank.totalGridPoints === null
                      ? "—"
                      : `${business.mapRank.foundInTop3Count} / ${business.mapRank.totalGridPoints}`
                  }
                />
                <Metric
                  label="Top 10 coverage"
                  value={
                    business.mapRank.foundInTop10Count === null ||
                    business.mapRank.totalGridPoints === null
                      ? "—"
                      : `${business.mapRank.foundInTop10Count} / ${business.mapRank.totalGridPoints}`
                  }
                />
                <Metric
                  label="Scan status"
                  value={business.mapRank.status ?? "—"}
                />
              </div>

              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field
                  label="Keyword"
                  value={business.mapRank.searchTerm || "—"}
                />
                <Field
                  label="Grid size"
                  value={
                    business.mapRank.gridSize === null
                      ? "—"
                      : `${business.mapRank.gridSize}×${business.mapRank.gridSize}`
                  }
                />
                <Field
                  label="Spacing"
                  value={
                    business.mapRank.spacingValue === null
                      ? "—"
                      : `${business.mapRank.spacingValue} ${business.mapRank.spacingUnit ?? ""}`.trim()
                  }
                />
                <Field
                  label="Scan date"
                  value={
                    business.mapRank.scannedAt
                      ? new Date(business.mapRank.scannedAt).toLocaleString(
                          "en-US",
                          { timeZone: "America/Boise" },
                        )
                      : "—"
                  }
                />
              </dl>

              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                  Rank grid
                </h3>
                <div className="mt-3">
                  <MapRankGrid ranks={business.mapRank.ranks} />
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-vezzt-950">
            Digital Presence
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            Ahrefs summary metrics. Parent brand and local path/subdomain values
            are stored separately and never added together.
          </p>

          {!business.seoParent && !business.seoLocal && !business.seo ? (
            <p className="mt-4 text-sm text-neutral-500">
              No SEO snapshot stored for this business yet.
            </p>
          ) : business.seoLocal ? (
            <div className="mt-4 space-y-6">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Parent Brand Authority
                </h3>
                {business.seoParent ? (
                  <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
                    <Metric
                      label="Parent domain"
                      value={
                        business.seoParent.parentDomain ||
                        business.seoParent.analysisTarget ||
                        "Not available"
                      }
                    />
                    <Metric
                      label="Domain Rating"
                      value={formatSeoMetric(business.seoParent.domainRating, {
                        digits: 1,
                      })}
                    />
                    <Metric
                      label="Parent organic traffic"
                      value={formatSeoMetric(business.seoParent.organicTraffic, {
                        kind: "integer",
                      })}
                    />
                    <Metric
                      label="Parent organic keywords"
                      value={formatSeoMetric(
                        business.seoParent.organicKeywords,
                        { kind: "integer" },
                      )}
                    />
                    <Metric
                      label="Parent referring domains"
                      value={formatSeoMetric(
                        business.seoParent.referringDomains,
                        { kind: "integer" },
                      )}
                    />
                    <Metric
                      label="Snapshot Date"
                      value={
                        business.seoParent.snapshotDate || "Not available"
                      }
                    />
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-neutral-500">
                    Parent-domain snapshot not stored yet.
                  </p>
                )}
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Local Website Presence
                </h3>
                <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
                  <Metric
                    label="Location target"
                    value={business.seoLocal.analysisTarget || "Not available"}
                  />
                  <Metric
                    label="Analysis mode"
                    value={business.seoLocal.analysisMode || "Not available"}
                  />
                  <Metric
                    label="Organic traffic"
                    value={formatSeoMetric(business.seoLocal.organicTraffic, {
                      kind: "integer",
                    })}
                  />
                  <Metric
                    label="Organic keywords"
                    value={formatSeoMetric(business.seoLocal.organicKeywords, {
                      kind: "integer",
                    })}
                  />
                  <Metric
                    label="Keywords 1–3"
                    value={formatSeoMetric(
                      business.seoLocal.organicKeywordsTop3,
                      { kind: "integer" },
                    )}
                  />
                  <Metric
                    label="Local referring domains"
                    value={formatSeoMetric(business.seoLocal.referringDomains, {
                      kind: "integer",
                    })}
                  />
                  <Metric
                    label="Local traffic value"
                    value={formatSeoMetric(business.seoLocal.trafficValue, {
                      kind: "currency",
                    })}
                  />
                  <Metric
                    label="Snapshot Date"
                    value={business.seoLocal.snapshotDate || "Not available"}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Search Presence
              </h3>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <Metric
                  label="Domain"
                  value={
                    business.seoParent?.parentDomain ||
                    business.seo?.domain ||
                    "Not available"
                  }
                />
                <Metric
                  label="Domain Rating"
                  value={formatSeoMetric(
                    (business.seoParent ?? business.seo)?.domainRating,
                    { digits: 1 },
                  )}
                />
                <Metric
                  label="Organic Traffic"
                  value={formatSeoMetric(
                    (business.seoParent ?? business.seo)?.organicTraffic,
                    { kind: "integer" },
                  )}
                />
                <Metric
                  label="Organic Keywords"
                  value={formatSeoMetric(
                    (business.seoParent ?? business.seo)?.organicKeywords,
                    { kind: "integer" },
                  )}
                />
                <Metric
                  label="Keywords in Positions 1–3"
                  value={formatSeoMetric(
                    (business.seoParent ?? business.seo)?.organicKeywordsTop3,
                    { kind: "integer" },
                  )}
                />
                <Metric
                  label="Referring Domains"
                  value={formatSeoMetric(
                    (business.seoParent ?? business.seo)?.referringDomains,
                    { kind: "integer" },
                  )}
                />
                <Metric
                  label="Backlinks"
                  value={formatSeoMetric(
                    (business.seoParent ?? business.seo)?.backlinks,
                    { kind: "integer" },
                  )}
                />
                <Metric
                  label="Traffic Value"
                  value={formatSeoMetric(
                    (business.seoParent ?? business.seo)?.trafficValue,
                    { kind: "currency" },
                  )}
                />
                <Metric
                  label="Snapshot Date"
                  value={
                    (business.seoParent ?? business.seo)?.snapshotDate ||
                    "Not available"
                  }
                />
              </div>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-vezzt-950">
            Proprietary metrics
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            Values come from `business_metrics` when present. Growth / market /
            brand scores require a future `proprietary_scores` table.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric
              label="Vestimate low"
              value={formatNullable(business.vestimateLow, { kind: "currency" })}
            />
            <Metric
              label="Vestimate mid"
              value={formatNullable(business.vestimateMid, { kind: "currency" })}
            />
            <Metric
              label="Vestimate high"
              value={formatNullable(business.vestimateHigh, {
                kind: "currency",
              })}
            />
            <Metric
              label="Vestimate confidence"
              value={formatNullable(business.confidenceScore)}
            />
            <Metric
              label="Growth Score"
              value={formatNullable(business.growthScore)}
            />
            <Metric
              label="Market Strength"
              value={formatNullable(business.marketStrength)}
            />
            <Metric
              label="Brand Strength"
              value={formatNullable(business.brandStrength)}
            />
            <Metric
              label="Acquisition Score"
              value={formatNullable(business.acquisitionScore)}
            />
          </div>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-vezzt-950">
            Review snapshot history
          </h2>
          <div className="mt-4">
            <ReviewCountChart snapshots={business.snapshots} />
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Reviews</th>
                  <th className="py-2 pr-4">Rating</th>
                  <th className="py-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {business.snapshots.map((s) => (
                  <tr key={s.id} className="border-t border-neutral-100">
                    <td className="py-2 pr-4">{s.snapshotDate}</td>
                    <td className="py-2 pr-4 tabular-nums">
                      {s.reviewCount === null
                        ? "—"
                        : s.reviewCount.toLocaleString("en-US")}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">
                      {formatNullable(s.averageRating, { kind: "rating" })}
                    </td>
                    <td className="py-2">{s.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-vezzt-950">
            Map Rank Schedule
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            GeoGrid scans only start Mon–Fri 10:00 AM–4:00 PM in the business
            location timezone (IANA / DST-aware).
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Metric
              label="Business timezone"
              value={business.mapScanSchedule?.timezone || "Missing"}
            />
            <Metric
              label="Current local time"
              value={business.mapScanSchedule?.currentLocalTime || "—"}
            />
            <Metric
              label="Scheduling status"
              value={business.mapScanSchedule?.scheduleStatus || "—"}
            />
            <Metric
              label="Next eligible scan"
              value={
                business.mapScanSchedule?.nextEligibleAt
                  ? new Date(
                      business.mapScanSchedule.nextEligibleAt,
                    ).toLocaleString("en-US", {
                      timeZone:
                        business.mapScanSchedule.timezone || "America/Boise",
                    })
                  : business.mapScanSchedule?.scheduleStatus === "eligible"
                    ? "Eligible now"
                    : "—"
              }
            />
            <Metric
              label="Wait reason"
              value={business.mapScanSchedule?.waitReason || "—"}
            />
            <Metric
              label="Last scan requested"
              value={
                business.mapScanSchedule?.lastRequestedAt
                  ? new Date(
                      business.mapScanSchedule.lastRequestedAt,
                    ).toLocaleString("en-US", {
                      timeZone:
                        business.mapScanSchedule.timezone || "America/Boise",
                    })
                  : "—"
              }
            />
          </div>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-vezzt-950">
            Market Snapshot
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            Market-level US Census ACS demographics for this business&apos;s
            comparison geography. Shared across locations — not copied onto the
            business row.
          </p>
          {!business.market ? (
            <p className="mt-4 text-sm text-neutral-500">Not available.</p>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
              <Metric
                label="Market"
                value={business.market.marketName || "Not available."}
              />
              <Metric
                label="Population"
                value={
                  business.market.population == null
                    ? "Not available."
                    : business.market.population.toLocaleString("en-US")
                }
              />
              <Metric
                label="Households"
                value={
                  business.market.households == null
                    ? "Not available."
                    : business.market.households.toLocaleString("en-US")
                }
              />
              <Metric
                label="Housing Units"
                value={
                  business.market.housingUnits == null
                    ? "Not available."
                    : business.market.housingUnits.toLocaleString("en-US")
                }
              />
              <Metric
                label="Owner-Occupied Homes"
                value={
                  business.market.ownerOccupiedUnits == null
                    ? "Not available."
                    : business.market.ownerOccupiedUnits.toLocaleString("en-US")
                }
              />
              <Metric
                label="Owner-Occupied Rate"
                value={
                  business.market.ownerOccupiedRate == null
                    ? "Not available."
                    : `${business.market.ownerOccupiedRate.toFixed(1)}%`
                }
              />
              <Metric
                label="Median Household Income"
                value={
                  business.market.medianHouseholdIncome == null
                    ? "Not available."
                    : formatCurrency(business.market.medianHouseholdIncome)
                }
              />
              <Metric
                label="Median Home Value"
                value={
                  business.market.medianHomeValue == null
                    ? "Not available."
                    : formatCurrency(business.market.medianHomeValue)
                }
              />
              <Metric
                label="Median Year Structure Built"
                value={
                  business.market.medianYearStructureBuilt == null
                    ? "Not available."
                    : String(
                        Math.round(business.market.medianYearStructureBuilt),
                      )
                }
              />
              <Metric
                label="Census dataset year"
                value={
                  business.market.datasetYear == null
                    ? "Not available."
                    : String(business.market.datasetYear)
                }
              />
            </div>
          )}
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-vezzt-950">
            Market Area Snapshot
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            US Census ACS ZIP Code Tabulation Area (ZCTA) demographics for this
            business postal code. Raw reference data only — not used for ranking.
          </p>
          {!business.zipStats ? (
            <p className="mt-4 text-sm text-neutral-500">
              No Census ZCTA data linked for ZIP{" "}
              {business.postalCode?.trim() || "—"}.
            </p>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
              <Metric label="ZIP Code" value={business.zipStats.zipCode} />
              <Metric
                label="ZIP Population"
                value={
                  business.zipStats.population == null
                    ? "—"
                    : business.zipStats.population.toLocaleString("en-US")
                }
              />
              <Metric
                label="Households"
                value={
                  business.zipStats.households == null
                    ? "—"
                    : business.zipStats.households.toLocaleString("en-US")
                }
              />
              <Metric
                label="Housing Units"
                value={
                  business.zipStats.housingUnits == null
                    ? "—"
                    : business.zipStats.housingUnits.toLocaleString("en-US")
                }
              />
              <Metric
                label="Owner-Occupied Housing Units"
                value={
                  business.zipStats.ownerOccupiedHousingUnits == null
                    ? "—"
                    : business.zipStats.ownerOccupiedHousingUnits.toLocaleString(
                        "en-US",
                      )
                }
              />
              <Metric
                label="Owner-Occupied Rate"
                value={
                  business.zipStats.ownerOccupiedRate == null
                    ? "—"
                    : `${business.zipStats.ownerOccupiedRate.toFixed(1)}%`
                }
              />
              <Metric
                label="Median Household Income"
                value={
                  business.zipStats.medianHouseholdIncome == null
                    ? "—"
                    : formatCurrency(business.zipStats.medianHouseholdIncome)
                }
              />
              <Metric
                label="Median Home Value"
                value={
                  business.zipStats.medianHomeValue == null
                    ? "—"
                    : formatCurrency(business.zipStats.medianHomeValue)
                }
              />
              <Metric
                label="Median Year Structure Built"
                value={
                  business.zipStats.medianYearStructureBuilt == null
                    ? "—"
                    : String(
                        Math.round(business.zipStats.medianYearStructureBuilt),
                      )
                }
              />
              <Metric
                label="Census dataset year"
                value={
                  business.zipStats.datasetYear == null
                    ? "—"
                    : String(business.zipStats.datasetYear)
                }
              />
            </div>
          )}
        </section>

        <section className="rounded-xl border border-dashed border-neutral-400 bg-neutral-50 p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-vezzt-950">
              Model testing (internal)
            </h2>
            <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
              Not public
            </span>
          </div>
          <p className="mt-1 text-xs text-neutral-600">
            Raw scoring inputs for formula experimentation. Missing values are
            shown as null — nothing is invented.
          </p>
          <p className="mt-3 text-xs text-neutral-700">
            <span className="font-medium">Score / model version:</span>{" "}
            {SCORE_MODEL_STATUS}
          </p>
          <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {rawInputs.map((row) => (
              <div
                key={row.label}
                className="rounded-lg border border-neutral-200 bg-white px-3 py-2"
              >
                <dt className="font-mono text-[11px] text-neutral-500">
                  {row.label}
                </dt>
                <dd
                  className={`mt-0.5 font-mono text-xs ${
                    row.value.includes("null")
                      ? "text-amber-700"
                      : "text-vezzt-950"
                  }`}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </main>
    </div>
  );
}
