import { Link, useLocation, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useCallback, useEffect } from "react";
import { getSubmission, listSubmissions, uploadSubmissionAssetProxy } from "../api/client";
import type { Asset, SubmissionDetail as SubmissionDetailType } from "../types/submission";
import AssetGallery, { DownloadIcon } from "../components/AssetGallery";
import { formatDate, formatIfDate } from "../utils/dateUtils";
import { ui } from "../components/ui";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function normalizedKey(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1 px-1.5 rounded-lg hover:bg-zinc-200/50 text-zinc-400 hover:text-zinc-600 transition-all flex items-center justify-center active:scale-95 group"
      title="In Zwischenablage kopieren"
    >
      {copied ? (
        <svg className="w-4 h-4 text-[#3ec099]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-4 h-4 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  );
}

const UNKNOWN_VALUE = "Nicht angegeben";

const FIELD_LABELS: Record<string, string> = {
  mileage: "Kilometerstand",
  tuvUntil: "TÜV bis",
  accidentFree: "Unfallfrei",
  accidentDescription: "Unfallbeschreibung",
  numberOfOwners: "Anzahl Vorbesitzer",
  numberOfKeys: "Anzahl Schlüssel",
  formOfOwnership: "Besitzform",
  isPetCar: "Tierfahrzeug",
  isSmokerCar: "Raucherfahrzeug",
  hasTrailerHitch: "Anhängerkupplung",
  tyreTypes: "Reifentypen",
  tyreDetailsSummary: "Reifendetails",
  vehicleDefectsSummary: "Mängelübersicht",
  vehicleDocuments: "Fahrzeugdokumente",
  chargingCableSummary: "Ladekabel",
  digitalCheckbook: "Digitales Serviceheft",
  digitalCheckbookPhotos: "Fotos Serviceheft",
  serviceHistoryMaintained: "Servicehistorie gepflegt",
  registrationDocumentOwner: "Halter Zulassungsdokument",
  pickupAgreement: "Abholvereinbarung",
  vehicleAgreement: "Fahrzeugvereinbarung",
  informationDisclosureAgreement: "Einwilligung Datenauskunft",
  additionalAccessories: "Zubehör",
  nonOriginalConditionDescription: "Abweichung vom Originalzustand",
  sellerType: "Verkäufertyp",
  whatsappConsent: "WhatsApp-Einwilligung",
  newsLetter: "Newsletter",
  policyConfirmation: "Datenschutz bestätigt",
  gaClientId: "GA Client ID",
  gClId: "Google Click ID",
  fbClId: "Facebook Click ID",
  utmSource: "UTM Quelle",
  utmMedium: "UTM Medium",
  utmCampaign: "UTM Kampagne",
  utmContent: "UTM Content",
  utmTerm: "UTM Suchbegriff",
};

const OPTION_LABELS: Record<string, Record<string, string>> = {
  formOfOwnership: {
    owned: "Eigentum",
    leased: "Leasing",
    financed: "Finanziert",
  },
  sellerType: {
    private: "Privat",
    commercial: "Gewerblich",
    dealer: "Händler",
  },
  registrationDocumentOwner: {
    bank: "Bank",
    seller: "Verkäufer",
  },
  tyreTypes: {
    sommerreifen: "Sommerreifen",
    winterreifen: "Winterreifen",
    ganzjahresreifen: "Ganzjahresreifen",
  },
  treadCondition: {
    abgenutzt: "Abgenutzt",
    in_ordnung: "In Ordnung",
    wie_neu: "Wie neu",
    weiss_ich_nicht: "Weiß ich nicht",
  },
  vehicleDefectType: {
    karosserie: "Karosserie",
    innenraum: "Innenraum",
    felgen_verkratzt: "Felgen verkratzt",
    technische_maengel: "Technische Mängel",
    unreparierter_unfallschaden: "Unreparierter Unfallschaden",
    fehlermeldungen_display: "Fehlermeldungen Display",
    sonstige_maengel: "Sonstige Mängel",
  },
  vehicleDocuments: {
    coc_certificate: "COC",
    registration_document: "Zulassungsdokument",
    vehicle_ownership_document: "Eigentumsnachweis",
  },
};

function titleFromToken(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function mapRimSize(value: string): string {
  if (value === "weiss_ich_nicht") return "Weiß ich nicht";
  const foreign = value.match(/^(\d+)_fremdmarke$/);
  if (foreign) return `${foreign[1]}" Fremdmarke`;
  const originalTesla = value.match(/^(\d+)_(.+)_original_tesla$/);
  if (originalTesla) {
    return `${originalTesla[1]}" ${titleFromToken(originalTesla[2])} (Original Tesla)`;
  }
  return titleFromToken(value);
}

function mapOptionValue(field: string, value: string): string {
  if (field === "rimSize") return mapRimSize(value);
  const mapped = OPTION_LABELS[field]?.[value];
  if (mapped) return mapped;
  if (value === "weiss_ich_nicht") return "Weiß ich nicht";
  return titleFromToken(value);
}

function buildTyreDetailsSummary(tyreDetails: unknown): string[] {
  if (!isRecord(tyreDetails)) return [];
  return Object.entries(tyreDetails)
    .flatMap(([tyreType, detail]) => {
      if (!isRecord(detail)) return [];
      const rimSize = asString(detail.rimSize);
      const rimType = asString(detail.rimType);
      const tread = asString(detail.treadCondition);
      const segments = [
        mapOptionValue("tyreTypes", tyreType),
        rimSize ? mapOptionValue("rimSize", rimSize) : null,
        rimType ? mapOptionValue("rimType", rimType) : null,
        tread ? mapOptionValue("treadCondition", tread) : null,
      ].filter((v): v is string => !!v);
      return segments.length > 0 ? [segments.join(" - ")] : [];
    });
}

function buildDefectsSummary(defects: unknown): string[] {
  if (!Array.isArray(defects)) return [];
  return defects.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const type = asString(entry.type);
    const description = asString(entry.description);
    const label = type ? mapOptionValue("vehicleDefectType", type) : null;
    if (label && description) return [`${label}: ${description}`];
    if (label) return [label];
    if (description) return [description];
    return [];
  });
}

function buildChargingCableSummary(chargingCable: unknown): string[] {
  if (!isRecord(chargingCable)) return [];
  const labels: Record<string, string> = { typ2: "Typ 2", schuko: "Schuko" };
  return Object.entries(chargingCable).flatMap(([key, present]) => {
    if (present !== true) return [];
    return [labels[key] ?? titleFromToken(key)];
  });
}

function sanitizeAdvanceDisplayData(data: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!data) return null;

  const out: Record<string, unknown> = {};
  const allowedKeys = [
    "mileage",
    "tuvUntil",
    "accidentFree",
    "accidentDescription",
    "numberOfOwners",
    "numberOfKeys",
    "formOfOwnership",
    "isPetCar",
    "isSmokerCar",
    "hasTrailerHitch",
    "tyreTypes",
    "vehicleDocuments",
    "digitalCheckbook",
    "digitalCheckbookPhotos",
    "serviceHistoryMaintained",
    "registrationDocumentOwner",
    "pickupAgreement",
    "vehicleAgreement",
    "informationDisclosureAgreement",
    "additionalAccessories",
    "nonOriginalConditionDescription",
  ];

  allowedKeys.forEach((key) => {
    if (key in data) out[key] = data[key];
  });

  const tyreSummary = buildTyreDetailsSummary(data.tyreDetails);
  if (tyreSummary.length > 0) out.tyreDetailsSummary = tyreSummary;

  const defectsSummary = buildDefectsSummary(data.vehicleDefects);
  if (defectsSummary.length > 0) out.vehicleDefectsSummary = defectsSummary;

  const cableSummary = buildChargingCableSummary(data.chargingCable);
  if (cableSummary.length > 0) out.chargingCableSummary = cableSummary;

  return out;
}

function normalizeAdvanceData(
  raw: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!raw) return null;
  const nested = raw.submissionData;
  if (isRecord(nested)) return nested;

  const advanceFieldKeys = new Set([
    "mileage",
    "tuvUntil",
    "accidentFree",
    "accidentDescription",
    "numberOfOwners",
    "numberOfKeys",
    "formOfOwnership",
    "isPetCar",
    "isSmokerCar",
    "hasTrailerHitch",
    "tyreTypes",
    "tyreDetails",
    "vehicleDefects",
    "vehicleDocuments",
    "chargingCable",
    "digitalCheckbook",
    "digitalCheckbookPhotos",
    "serviceHistoryMaintained",
    "registrationDocumentOwner",
    "pickupAgreement",
    "vehicleAgreement",
    "informationDisclosureAgreement",
    "additionalAccessories",
    "nonOriginalConditionDescription",
  ]);

  const rawKeys = Object.keys(raw);
  const looksLikeFormEngineEnvelope =
    rawKeys.includes("values") ||
    rawKeys.includes("last_submitted") ||
    rawKeys.includes("submission_start") ||
    rawKeys.includes("user_id");
  if (looksLikeFormEngineEnvelope) return null;

  const hasKnownAdvanceFields = rawKeys.some((key) => advanceFieldKeys.has(key));
  return hasKnownAdvanceFields ? raw : null;
}

const INITIAL_FIELD_ALIASES: Record<string, string[]> = {
  vin: ["vin"],
  email: ["email", "mail"],
  phone: ["phone", "phoneNumber", "phone_number", "mobile", "mobilePhone"],
  firstName: ["firstName", "first_name", "firstname"],
  lastName: ["lastName", "last_name", "lastname"],
  mileage: ["mileage", "kilometers", "km"],
  sellerType: ["sellerType", "seller_type"],
  newsLetter: ["newsLetter", "newsletter", "news_letter"],
  whatsappConsent: ["whatsappConsent", "whatsapp_consent"],
  policyConfirmation: ["policyConfirmation", "policy_confirmation"],
  gaClientId: ["gaClientId", "ga_client_id"],
  gClId: ["gClId", "gclid", "g_cl_id"],
  fbClId: ["fbClId", "fbclid", "fb_cl_id"],
  utmSource: ["utmSource", "utm_source"],
  utmMedium: ["utmMedium", "utm_medium"],
  utmCampaign: ["utmCampaign", "utm_campaign"],
  utmContent: ["utmContent", "utm_content"],
  utmTerm: ["utmTerm", "utm_term"],
};

function mapInitialFields(input: Record<string, unknown>): Record<string, unknown> | null {
  const normalizedEntries = Object.entries(input).map(([key, value]) => [key.toLowerCase(), value] as const);
  const normalized = new Map<string, unknown>(normalizedEntries);
  const out: Record<string, unknown> = {};

  Object.entries(INITIAL_FIELD_ALIASES).forEach(([targetKey, aliases]) => {
    for (const alias of aliases) {
      const match = normalized.get(alias.toLowerCase());
      if (match !== undefined) {
        out[targetKey] = match;
        break;
      }
    }
  });

  return Object.keys(out).length > 0 ? out : null;
}

function normalizeInitialData(
  raw: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!raw) return null;

  const values = raw.values;
  const looksLikeFeatheryEnvelope =
    Array.isArray(values) &&
    ("user_id" in raw || "last_submitted" in raw || "submission_start" in raw);

  if (looksLikeFeatheryEnvelope) {
    const extracted: Record<string, unknown> = {};
    values.forEach((item) => {
      if (!isRecord(item)) return;
      const id = asString(item.id);
      if (!id) return;
      extracted[id] = item.value;
    });
    return mapInitialFields(extracted);
  }

  return mapInitialFields(raw);
}

function extractSubmissionData(
  detail: SubmissionDetailType | undefined,
  intake: "initial" | "advance"
): Record<string, unknown> | null {
  if (!detail) return null;

  const topLevel = isRecord(detail.submissionData) ? detail.submissionData : null;
  const nestedSnakeCase = isRecord(detail.submission)
    ? detail.submission.submission_data
    : null;
  const snakeCase = isRecord(nestedSnakeCase) ? nestedSnakeCase : null;
  const raw = topLevel ?? snakeCase;

  if (!raw) return null;
  return intake === "advance" ? normalizeAdvanceData(raw) : normalizeInitialData(raw);
}

function getLatestByIntake(
  first: SubmissionDetailType | undefined,
  second: SubmissionDetailType | undefined,
  intake: "initial" | "advance"
): SubmissionDetailType | undefined {
  const candidates = [first, second].filter(
    (item): item is SubmissionDetailType => !!item && item.formIntake?.toLowerCase() === intake
  );
  if (candidates.length === 0) return undefined;
  return [...candidates].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
}

function mergeAssets(first: Asset[] | undefined, second: Asset[] | undefined): Asset[] {
  const map = new Map<string, Asset>();
  [...(first ?? []), ...(second ?? [])].forEach((asset) => {
    if (!map.has(asset.key)) map.set(asset.key, asset);
  });
  return [...map.values()];
}

type FlatField = {
  path: string;
  value: string;
  rawValue: unknown;
};

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "string") return formatIfDate(value);

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function flattenData(value: unknown, prefix = "", out: FlatField[] = []): FlatField[] {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      if (prefix) out.push({ path: prefix, value: "[]", rawValue: value });
      return out;
    }

    const scalar = value.every((item) => !isRecord(item) && !Array.isArray(item));
    if (scalar) {
      if (prefix) out.push({ path: prefix, value: JSON.stringify(value), rawValue: value });
      return out;
    }

    value.forEach((item, index) => {
      const next = `${prefix}[${index}]`;
      flattenData(item, next, out);
    });
    return out;
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      if (prefix) out.push({ path: prefix, value: "{}", rawValue: value });
      return out;
    }

    entries.forEach(([key, item]) => {
      const next = prefix ? `${prefix}.${key}` : key;
      flattenData(item, next, out);
    });
    return out;
  }

  if (prefix) out.push({ path: prefix, value: stringifyValue(value), rawValue: value });
  return out;
}

type MergedRow = {
  field: string;
  value: string;
  rawValue: unknown;
  source: "initial" | "advance";
};

type TyreDetailRow = {
  tyreType: string;
  rimSize: string;
  rimType: string;
  treadCondition: string;
};

function buildMergedRows(
  initialData: Record<string, unknown> | null,
  advanceData: Record<string, unknown> | null
): MergedRow[] {
  const map = new Map<string, MergedRow>();

  const initialFlat = flattenData(initialData ?? {});
  initialFlat.forEach((item) => {
    map.set(item.path, {
      field: item.path,
      value: item.value,
      rawValue: item.rawValue,
      source: "initial",
    });
  });

  const isEmptyRaw = (v: unknown): boolean => {
    if (v === null || v === undefined || v === "") return true;
    if (Array.isArray(v) && v.length === 0) return true;
    if (isRecord(v) && Object.keys(v).length === 0) return true;
    return false;
  };

  const advanceFlat = flattenData(advanceData ?? {});
  advanceFlat.forEach((item) => {
    const existing = map.get(item.path);
    // Don't let an empty advance value override a populated initial value
    if (existing && existing.source === "initial" && isEmptyRaw(item.rawValue) && !isEmptyRaw(existing.rawValue)) {
      return;
    }
    map.set(item.path, {
      field: item.path,
      value: item.value,
      rawValue: item.rawValue,
      source: "advance",
    });
  });

  return [...map.values()].sort((a, b) => a.field.localeCompare(b.field));
}

function pipedriveUrl(dealId: string): string {
  return `https://app.pipedrive.com/deal/${encodeURIComponent(dealId)}`;
}

function formatFieldName(fieldName: string): string {
  return FIELD_LABELS[fieldName] ?? titleFromToken(fieldName);
}

function mapSingleValue(field: string, value: string): string {
  if (field === "mileage" && !Number.isNaN(Number(value))) {
    return `${Number(value).toLocaleString("de-DE")} km`;
  }
  if (field === "tuvUntil") return formatDate(value);
  if (field === "formOfOwnership" || field === "sellerType" || field === "registrationDocumentOwner") {
    return mapOptionValue(field, value);
  }
  if (field.startsWith("utm") || field.endsWith("Id") || field === "additionalAccessories" || field === "accidentDescription" || field === "nonOriginalConditionDescription") {
    return value;
  }
  return formatIfDate(value);
}

function mapArrayValue(field: string, values: string[]): string[] {
  if (field === "tyreDetailsSummary" || field === "vehicleDefectsSummary" || field === "chargingCableSummary") {
    return values;
  }
  return values.map((value) => {
    if (field === "vehicleDocuments") return OPTION_LABELS.vehicleDocuments[value] ?? titleFromToken(value);
    return mapSingleValue(field, value);
  });
}

function getDisplayValue(row: MergedRow): string {
  if (typeof row.rawValue === "boolean") return row.rawValue ? "Ja" : "Nein";
  if (typeof row.rawValue === "number" && Number.isFinite(row.rawValue)) {
    if (row.field === "mileage") return `${row.rawValue.toLocaleString("de-DE")} km`;
    return row.rawValue.toLocaleString("de-DE");
  }
  if (typeof row.rawValue === "string") return mapSingleValue(row.field, row.rawValue);
  return row.value;
}

function parseTyreDetailRows(data: Record<string, unknown> | null): TyreDetailRow[] {
  if (!data) return [];

  const tyreTypes = Array.isArray(data.tyreTypes)
    ? data.tyreTypes.filter((value): value is string => typeof value === "string" && value.trim() !== "")
    : [];
  const tyreDetails = isRecord(data.tyreDetails) ? data.tyreDetails : null;
  const detailKeys = tyreDetails ? Object.keys(tyreDetails) : [];
  const orderedKeys = [...tyreTypes, ...detailKeys.filter((key) => !tyreTypes.includes(key))];

  return orderedKeys.map((tyreType) => {
    const detail = tyreDetails && isRecord(tyreDetails[tyreType]) ? tyreDetails[tyreType] : null;
    const rimSizeRaw = detail ? asString(detail.rimSize) : undefined;
    const rimTypeRaw = detail ? asString(detail.rimType) : undefined;
    const treadConditionRaw = detail ? asString(detail.treadCondition) : undefined;

    return {
      tyreType: mapOptionValue("tyreTypes", tyreType),
      rimSize: rimSizeRaw ? mapOptionValue("rimSize", rimSizeRaw) : UNKNOWN_VALUE,
      rimType: rimTypeRaw ? mapOptionValue("rimType", rimTypeRaw) : UNKNOWN_VALUE,
      treadCondition: treadConditionRaw ? mapOptionValue("treadCondition", treadConditionRaw) : UNKNOWN_VALUE,
    };
  });
}

const ANALYTICS_KEYS = ["gaClientId", "gClId", "fbClId", "utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm", "newsLetter", "policyConfirmation"];
const LONG_TEXT_SUBMISSION_FIELDS = new Set([
  "accidentDescription",
  "additionalAccessories",
  "nonOriginalConditionDescription",
  "vehicleDefectsSummary",
]);

type CaseState = "initial" | "partial" | "completed";

function caseStateBadgeClasses(state: CaseState): string {
  if (state === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (state === "partial") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function caseStateLabel(state: CaseState): string {
  if (state === "completed") return "Abgeschlossen";
  if (state === "partial") return "In Bearbeitung";
  return "Eingang";
}

function SubmissionDataViewer({ rows, title, defaultCollapsed = false }: { rows: MergedRow[]; title: string; defaultCollapsed?: boolean }) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [showEmpty, setShowEmpty] = useState(false);

  const isEmpty = (row: MergedRow) => {
    if (row.field === "vehicleDocuments") return false;
    if (row.rawValue === null || row.rawValue === undefined || row.rawValue === "") return true;
    if (Array.isArray(row.rawValue) && row.rawValue.length === 0) return true;
    if (isRecord(row.rawValue) && Object.keys(row.rawValue).length === 0) return true;
    if (row.value === "[]" || row.value === "{}") return true;
    return false;
  };

  const emptyCount = rows.filter(isEmpty).length;
  const nonEmptyRows = rows.filter((row) => !isEmpty(row));
  const emptyRows = rows.filter(isEmpty);
  const visibleRows = showEmpty ? [...nonEmptyRows, ...emptyRows] : nonEmptyRows;
  const isLongTextRow = (row: MergedRow) => LONG_TEXT_SUBMISSION_FIELDS.has(row.field);
  const mainRows = visibleRows.filter((row) => !isLongTextRow(row));
  const longTextRows = visibleRows.filter(isLongTextRow);
  const mid = Math.ceil(mainRows.length / 2);
  const leftRows = mainRows.slice(0, mid);
  const rightRows = mainRows.slice(mid);

  const renderRow = (row: MergedRow) => {
    const isBool = typeof row.rawValue === "boolean";
    const isStringArray = Array.isArray(row.rawValue) && row.rawValue.length > 0 && row.rawValue.every(v => typeof v === 'string');
    const mappedArray = isStringArray ? mapArrayValue(row.field, row.rawValue as string[]) : [];
    const isVehicleDocuments = row.field === "vehicleDocuments";
    const isDisclosureAgreement = row.field === "informationDisclosureAgreement";
    const shouldExpandRow = isVehicleDocuments;

    return (
      <div
        key={row.field}
        className={`flex justify-between border-b border-zinc-100 last:border-0 ${shouldExpandRow ? "items-start py-2" : "items-center h-9"} ${isDisclosureAgreement ? "" : "overflow-hidden"}`}
      >
        <span
          className={`text-sm font-bold text-zinc-500 pr-4 shrink-0 ${isDisclosureAgreement ? "w-auto whitespace-nowrap" : "w-1/3 truncate"}`}
          title={formatFieldName(row.field)}
        >
          {formatFieldName(row.field)}
        </span>
        <div className="flex-1 min-w-0 text-right">
          {isBool ? (
            <div className="flex items-center justify-end gap-2 h-full">
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${row.rawValue ? "bg-[#3ec099]/10 border-[#3ec099]/30 text-[#3ec099]" : "bg-rose-50 border-rose-200 text-rose-600"}`}>
                {row.rawValue ? "Ja" : "Nein"}
              </span>
            </div>
          ) : isStringArray ? (
            <div className={isVehicleDocuments ? "flex flex-col items-end gap-1 py-1" : "flex justify-end gap-1"}>
              {mappedArray.map((v, i) => (
                <span
                  key={i}
                  className={isVehicleDocuments
                    ? "bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded text-[10px] font-bold text-emerald-700 uppercase tracking-tight"
                    : "bg-zinc-100 border border-zinc-200 px-2 py-0.5 rounded text-[10px] font-bold text-zinc-600 uppercase tracking-tight"}
                >
                  {v}
                </span>
              ))}
            </div>
          ) : (
            <div
              className={`text-base truncate ${isEmpty(row) ? 'text-zinc-300 italic' : 'text-zinc-900 font-bold'}`}
            >
              {isEmpty(row) ? 'Leer' : getDisplayValue(row)}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderLongTextRow = (row: MergedRow) => {
    const isBool = typeof row.rawValue === "boolean";
    const isStringArray = Array.isArray(row.rawValue) && row.rawValue.length > 0 && row.rawValue.every((v) => typeof v === "string");
    const mappedArray = isStringArray ? mapArrayValue(row.field, row.rawValue as string[]) : [];

    return (
      <div key={row.field} className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">{formatFieldName(row.field)}</p>
        <div className="mt-2 text-base text-zinc-900">
          {isBool ? (
            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${row.rawValue ? "bg-[#3ec099]/10 border-[#3ec099]/30 text-[#3ec099]" : "bg-rose-50 border-rose-200 text-rose-600"}`}>
              {row.rawValue ? "Ja" : "Nein"}
            </span>
          ) : isStringArray ? (
            <div className="space-y-2">
              {mappedArray.map((value, index) => (
                <p key={index} className="font-bold break-words whitespace-pre-wrap leading-6">
                  {value}
                </p>
              ))}
            </div>
          ) : (
            <p className={`break-words whitespace-pre-wrap leading-6 ${isEmpty(row) ? "text-zinc-300 italic" : "font-bold"}`}>
              {isEmpty(row) ? "Leer" : getDisplayValue(row)}
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 space-y-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex items-center gap-2 group"
          >
            <div className={`p-1.5 rounded-lg bg-zinc-50 border border-zinc-100 group-hover:bg-zinc-100 transition-colors ${isCollapsed ? '-rotate-90' : ''}`}>
              <svg className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            <h2 className="text-base font-bold text-zinc-900">{title}</h2>
          </button>
          {!isCollapsed && (
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider bg-zinc-50 border border-zinc-100 px-2 py-0.5 rounded-full">
              {rows.length} Felder
            </span>
          )}
        </div>
        {!isCollapsed && emptyCount > 0 && (
          <button
            onClick={() => setShowEmpty(!showEmpty)}
            className="text-xs text-[#3ec099] hover:underline font-bold transition-colors shrink-0"
          >
            {showEmpty ? "Leere ausblenden" : `+${emptyCount} leere Felder`}
          </button>
        )}
      </div>

      {!isCollapsed && (
        <>

      {visibleRows.length === 0 ? (
        <div className="py-10 text-center border-2 border-dashed border-zinc-100 rounded-2xl bg-zinc-50/50">
          <p className="text-sm text-zinc-400 font-bold">Keine Daten vorhanden.</p>
        </div>
      ) : (
        <div className="border-t border-zinc-100 pt-5">
          {mainRows.length > 0 && (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="space-y-0.5">
                {leftRows.map(renderRow)}
              </div>
              <div className="space-y-0.5">
                {rightRows.map(renderRow)}
              </div>
            </div>
          )}
          {longTextRows.length > 0 && (
            <div className={`${mainRows.length > 0 ? "mt-5" : ""} space-y-3`}>
              {longTextRows.map(renderLongTextRow)}
            </div>
          )}
        </div>
      )}
        </>
      )}
    </div>
  );
}

function TyresSection({ tyreRows }: { tyreRows: TyreDetailRow[] }) {
  const treadConditionClasses = (value: string): string => {
    const normalized = value.trim().toLowerCase();
    if (normalized === "wie neu" || normalized === "in ordnung") {
      return "bg-emerald-50 border-emerald-200 text-emerald-700";
    }
    if (normalized === "abgenutzt") {
      return "bg-amber-50 border-amber-200 text-amber-700";
    }
    if (normalized === "weiß ich nicht" || value === UNKNOWN_VALUE) {
      return "bg-zinc-100 border-zinc-200 text-zinc-600";
    }
    return "bg-sky-50 border-sky-200 text-sky-700";
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 space-y-4 shadow-sm">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-bold text-zinc-900">Reifen</h2>
        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider bg-zinc-50 border border-zinc-100 px-2 py-0.5 rounded-full">
          {tyreRows.length} Sätze
        </span>
      </div>

      {tyreRows.length === 0 ? (
        <div className="py-10 text-center border-2 border-dashed border-zinc-100 rounded-2xl bg-zinc-50/50">
          <p className="text-sm text-zinc-400 font-bold">Keine Reifenangaben vorhanden.</p>
        </div>
      ) : (
        <div className="border-t border-zinc-100 pt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          {tyreRows.map((tyre, index) => (
            <div key={`${tyre.tyreType}-${index}`} className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-4">
              <p className="text-base font-bold text-zinc-900">{tyre.tyreType}</p>
              <div className="mt-3 space-y-2 text-base">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-zinc-500 font-bold text-[10px] uppercase tracking-wider">Felgengröße</span>
                  <span className="text-zinc-800 font-bold text-right">{tyre.rimSize}</span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-zinc-500 font-bold text-[10px] uppercase tracking-wider">Felgentyp</span>
                  <span className="text-zinc-800 font-bold text-right">{tyre.rimType}</span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-zinc-500 font-bold text-[10px] uppercase tracking-wider">Profilzustand</span>
                  <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-bold ${treadConditionClasses(tyre.treadCondition)}`}>
                    {tyre.treadCondition}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PHOTO_UPLOAD_CATEGORIES = [
  "exterior",
  "interior",
  "rims",
  "defects",
  "tesla_autopilot",
  "digital_service_log",
  "damages",
] as const;

const PAPER_UPLOAD_CATEGORIES = [
  "registration_document",
  "coc_certificate",
  "service_book",
  "inspection_report",
  "invoice",
  "other_document",
] as const;

const UPLOAD_CATEGORY_LABELS: Record<string, string> = {
  exterior: "Außen",
  interior: "Innenraum",
  rims: "Felgen",
  defects: "Mängel",
  tesla_autopilot: "Tesla Autopilot",
  digital_service_log: "Digitales Serviceheft",
  damages: "Schäden",
  registration_document: "Zulassungsdokument",
  coc_certificate: "COC-Bescheinigung",
  service_book: "Serviceheft",
  inspection_report: "Prüfbericht",
  invoice: "Rechnung",
  other_document: "Sonstiges Dokument",
};

type UploadTarget = "photos" | "papers";

function FilePreviewThumb({ file, onRemove, isPending }: { file: File; onRemove: () => void; isPending: boolean }) {
  const isImage = file.type.startsWith("image/");
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage) return;
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  return (
    <div className="group relative aspect-square overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      {isImage && objectUrl ? (
        <img src={objectUrl} alt={file.name} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-2 bg-zinc-50">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-7 w-7 text-zinc-400">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <span className="w-full truncate text-center text-[10px] font-bold text-zinc-500 uppercase">PDF</span>
        </div>
      )}

      {/* Hover overlay: filename + size */}
      <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100 p-2">
        <p className="truncate text-[10px] font-bold text-white leading-tight">{file.name}</p>
        <p className="text-[9px] font-medium text-white/80">{formatFileSize(file.size)}</p>
      </div>

      {/* Remove button */}
      {!isPending && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Datei entfernen"
          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-rose-500/80 hover:text-white"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
            <path d="M4.22 4.22a.75.75 0 011.06 0L8 6.94l2.72-2.72a.75.75 0 111.06 1.06L9.06 8l2.72 2.72a.75.75 0 11-1.06 1.06L8 9.06l-2.72 2.72a.75.75 0 01-1.06-1.06L6.94 8 4.22 5.28a.75.75 0 010-1.06z" />
          </svg>
        </button>
      )}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ImageUploadCard({
  submissionId,
  onUploaded,
}: {
  submissionId: string;
  onUploaded: () => Promise<void> | void;
}) {
  const [target, setTarget] = useState<UploadTarget>("photos");
  const [category, setCategory] = useState<string>("exterior");
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [statusText, setStatusText] = useState<string>("");
  const [errorText, setErrorText] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const availableCategories = target === "photos" ? PHOTO_UPLOAD_CATEGORIES : PAPER_UPLOAD_CATEGORIES;
  const accept = target === "photos" ? "image/*" : "image/*,.pdf,application/pdf";

  const addFiles = useCallback((incoming: File[]) => {
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name + f.size));
      const deduped = incoming.filter((f) => !existing.has(f.name + f.size));
      return [...prev, ...deduped];
    });
    setErrorText("");
    setStatusText("");
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  }, [addFiles]);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (files.length === 0) throw new Error("Bitte mindestens eine Datei auswählen.");

      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const isImage = file.type.startsWith("image/");
        const isPdf = file.type === "application/pdf";
        if (target === "photos" && !isImage) {
          throw new Error(`"${file.name}" ist keine Bilddatei.`);
        }
        if (target === "papers" && !isImage && !isPdf) {
          throw new Error(`"${file.name}" ist kein unterstütztes Dokument.`);
        }

        setUploadProgress({ current: i + 1, total: files.length });
        await uploadSubmissionAssetProxy({ submissionId, file, target, category });
      }
    },
    onSuccess: async () => {
      const count = files.length;
      setErrorText("");
      setUploadProgress(null);
      setStatusText(`${count} Datei${count === 1 ? "" : "en"} erfolgreich hochgeladen.`);
      setFiles([]);
      await onUploaded();
      setTimeout(() => setStatusText(""), 4000);
    },
    onError: (error) => {
      setUploadProgress(null);
      setStatusText("");
      setErrorText(error instanceof Error ? error.message : "Upload fehlgeschlagen.");
    },
  });

  const isPending = uploadMutation.isPending;

  return (
    <div className={`${ui.card} p-6 space-y-5`}>
      {/* Header row: title + type/category selects */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="text-sm font-bold text-zinc-900 uppercase tracking-wider">Assets hochladen</h3>

        <div className="flex items-center gap-3">
          {/* Type toggle */}
          <div className="flex rounded-lg overflow-hidden border border-zinc-200 p-1 bg-zinc-50">
            {(["photos", "papers"] as UploadTarget[]).map((t) => (
              <button
                key={t}
                type="button"
                disabled={isPending}
                onClick={() => {
                  setTarget(t);
                  setCategory(t === "photos" ? "exterior" : "registration_document");
                  setErrorText("");
                  setStatusText("");
                }}
                className={`px-4 py-1.5 rounded-md text-[11px] font-bold transition-all ${
                  target === t
                    ? "bg-white text-[#3ec099] shadow-sm"
                    : "text-zinc-500 hover:text-zinc-700"
                } disabled:cursor-not-allowed`}
              >
                {t === "photos" ? "Fotos" : "Dokumente"}
              </button>
            ))}
          </div>

          {/* Category select */}
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={isPending}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-bold text-zinc-700 focus:border-[#3ec099] focus:outline-none focus:ring-2 focus:ring-[#3ec099]/10 disabled:cursor-not-allowed"
          >
            {availableCategories.map((item) => (
              <option key={item} value={item}>{UPLOAD_CATEGORY_LABELS[item] ?? item.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => !isPending && fileInputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed py-12 cursor-pointer transition-all duration-300 select-none ${
          isDragging
            ? "border-[#3ec099] bg-[#3ec099]/5"
            : "border-zinc-200 bg-zinc-50/50 hover:border-zinc-400 hover:bg-zinc-50"
        } ${isPending ? "pointer-events-none opacity-60" : ""}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={accept}
          className="sr-only"
          disabled={isPending}
          onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
        />
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`h-10 w-10 transition-colors ${isDragging ? "text-[#3ec099]" : "text-zinc-400"}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        <div className="text-center">
          <p className={`text-base font-bold transition-colors ${isDragging ? "text-[#3ec099]" : "text-zinc-900"}`}>
            {isDragging ? "Dateien hier ablegen" : "Dateien hier hineinziehen"}
          </p>
          <p className="text-sm font-medium text-zinc-500 mt-1">
            oder <span className="text-[#3ec099] underline underline-offset-4 decoration-2">klicken zum Auswaehlen</span>
          </p>
        </div>
      </div>

      {/* Selected files preview grid */}
      {files.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              {files.length} Datei{files.length === 1 ? "" : "en"} in Warteschlange
            </span>
            <button
              type="button"
              onClick={() => setFiles([])}
              disabled={isPending}
              className="text-[11px] font-bold text-zinc-400 hover:text-rose-500 transition-colors disabled:cursor-not-allowed"
            >
              Alle entfernen
            </button>
          </div>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
            {files.map((file, idx) => (
              <FilePreviewThumb
                key={`${file.name}-${file.size}-${idx}`}
                file={file}
                isPending={isPending}
                onRemove={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
              />
            ))}
          </div>
        </div>
      )}

      {/* Upload progress / action row */}
      <div className="flex items-center gap-4 pt-2">
        {uploadProgress ? (
          <div className="flex flex-1 items-center gap-3">
            <div className="flex-1 h-2 rounded-full bg-zinc-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-[#3ec099] transition-all duration-300 shadow-[0_0_10px_rgba(62,192,153,0.3)]"
                style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
              />
            </div>
            <span className="shrink-0 text-xs font-bold text-zinc-500">
              {uploadProgress.current}/{uploadProgress.total}
            </span>
          </div>
        ) : (
          <div className="flex-1">
            {statusText && <p className="text-xs font-bold text-[#3ec099]">{statusText}</p>}
            {errorText && <p className="text-xs font-bold text-rose-500">{errorText}</p>}
          </div>
        )}

        <button
          type="button"
          onClick={() => uploadMutation.mutate()}
          disabled={isPending || files.length === 0}
          className={`${ui.button} shrink-0 px-8 disabled:grayscale disabled:opacity-50 transition-all`}
        >
          {isPending ? "Lade hoch..." : `Hochladen ${files.length > 0 ? files.length : ""}`}
        </button>
      </div>
    </div>
  );
}

export default function SubmissionDetail({ submissionId }: { submissionId?: string } = {}) {
  const params = useParams<{ id: string }>();
  const id = submissionId ?? params.id;
  const location = useLocation();
  const queryClient = useQueryClient();
  const backToList = `/submissions${location.search}`;
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  const {
    data,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["submission", id],
    queryFn: () => getSubmission(id!),
    enabled: !!id,
  });

  const {
    data: linkedSubmission,
    isFetching: isFetchingLinked,
  } = useQuery({
    queryKey: ["linked-submission", data?.id, data?.formIntake, data?.vin, data?.pipedriveDealId, data?.identifierInformationId],
    enabled: !!data,
    queryFn: async () => {
      if (!data) return null;

      const currentIntake = data.formIntake?.toLowerCase();
      const targetIntake = currentIntake === "advance" ? "initial" : "advance";
      const caseByKey = new Map<string, Awaited<ReturnType<typeof listSubmissions>>["data"][number]>();

      if (data.pipedriveDealId) {
        const byDeal = await listSubmissions({ pipedriveDealId: data.pipedriveDealId, page: 1, pageSize: 100 });
        byDeal.data.forEach((item) => caseByKey.set(item.caseKey, item));
      }
      if (data.vin) {
        const byVin = await listSubmissions({ vin: data.vin, page: 1, pageSize: 100 });
        byVin.data.forEach((item) => caseByKey.set(item.caseKey, item));
      }

      if (caseByKey.size === 0) return null;

      const candidateSummaries = [...caseByKey.values()]
        .map((c) => (targetIntake === "initial" ? c.m1 : c.m15))
        .filter((s): s is NonNullable<typeof s> => !!s && s.id !== data.id);

      if (candidateSummaries.length === 0) return null;

      const currentIdentifier = normalizedKey(data.identifierInformationId);
      const currentDeal = normalizedKey(data.pipedriveDealId);
      const currentVin = normalizedKey(data.vin);
      const uniqueById = new Map(candidateSummaries.map((s) => [s.id, s]));
      const candidates = [...uniqueById.values()].slice(0, 10);

      const scoredCandidates = await Promise.all(
        candidates.map(async (summary) => {
          const detail = await getSubmission(summary.id).catch(() => null);
          const candidateIdentifier = normalizedKey(detail?.identifierInformationId);
          const candidateDeal = normalizedKey(detail?.pipedriveDealId ?? summary.pipedriveDealId ?? null);
          const candidateVin = normalizedKey(detail?.vin ?? summary.vin ?? null);

          let score = 0;
          if (currentIdentifier && candidateIdentifier && currentIdentifier === candidateIdentifier) score += 100;
          if (currentDeal && candidateDeal && currentDeal === candidateDeal) score += 50;
          if (currentVin && candidateVin && currentVin === candidateVin) score += 20;

          return { summary, detail, score };
        })
      );

      const best = scoredCandidates
        .sort((a, b) => b.score - a.score)[0];

      if (!best) return null;
      if (best.detail) return best.detail;
      return getSubmission(best.summary.id);
    },
    staleTime: 2 * 60_000,
  });

  if (isLoading) {
    return <div className="py-10 text-zinc-400">Lade Fall...</div>;
  }

  if (isError) {
    return (
      <div className="p-6">
        <Link to={backToList} className="text-sm font-bold text-zinc-500 hover:text-zinc-900 transition-colors">
          ← Zurück zur Liste
        </Link>
        <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 shadow-sm">
          <strong className="block text-rose-900 mb-1">Zugriffsfehler</strong>
          {error instanceof Error ? error.message : "Fall konnte nicht geladen werden"}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const m1Detail = getLatestByIntake(data, linkedSubmission ?? undefined, "initial");
  const m15Detail = getLatestByIntake(data, linkedSubmission ?? undefined, "advance");

  const initialSubmissionData = extractSubmissionData(m1Detail, "initial");
  const rawAdvanceSubmissionData = extractSubmissionData(m15Detail, "advance");
  const advanceSubmissionData = sanitizeAdvanceDisplayData(rawAdvanceSubmissionData);
  const tyreRows = parseTyreDetailRows(rawAdvanceSubmissionData);

  const contactFirstName = asString(initialSubmissionData?.firstName);
  const contactLastName = asString(initialSubmissionData?.lastName);
  const contactName = [contactFirstName, contactLastName].filter(Boolean).join(" ") || UNKNOWN_VALUE;
  const contactEmail = asString(initialSubmissionData?.email) ?? UNKNOWN_VALUE;
  const contactPhone = asString(initialSubmissionData?.phone) ?? UNKNOWN_VALUE;
  const contactSellerTypeRaw = asString(initialSubmissionData?.sellerType);
  const contactSellerType = contactSellerTypeRaw ? mapOptionValue("sellerType", contactSellerTypeRaw) : UNKNOWN_VALUE;

  const displaySubmissionRows = buildMergedRows(initialSubmissionData, advanceSubmissionData);
  const analyticsSourceRows = buildMergedRows(initialSubmissionData, null);

  const submissionRows = displaySubmissionRows.filter(
    (row) => !["firstName", "lastName", "email", "phone", "sellerType", "vin", "tyreTypes", "tyreDetailsSummary", ...ANALYTICS_KEYS].includes(row.field)
  );

  const analyticsRows = analyticsSourceRows.filter(
    (row) => ANALYTICS_KEYS.includes(row.field)
  );

  const caseAssets = mergeAssets(m15Detail?.assets, m1Detail?.assets);
  const assetSubmissionId = m15Detail?.id ?? data.id;

  const caseDat =
    (isRecord(m15Detail?.datInformation) ? m15Detail.datInformation : null) ??
    (isRecord(m1Detail?.datInformation) ? m1Detail.datInformation : null) ??
    null;

  const vin = asString(caseDat?.vin) ?? data.vin ?? UNKNOWN_VALUE;
  const make = asString(caseDat?.make) ?? UNKNOWN_VALUE;
  const model = asString(caseDat?.model) ?? UNKNOWN_VALUE;
  const variant = asString(caseDat?.variant) ?? UNKNOWN_VALUE;
  const firstRegistration = asString(caseDat?.first_registration) ?? UNKNOWN_VALUE;

  const pickMileage = (d: Record<string, unknown> | null): number | null => {
    if (!d) return null;
    const v = d.mileage ?? d.kilometers ?? d.km;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
    return null;
  };
  const mileageValue =
    pickMileage(advanceSubmissionData) ??
    pickMileage(initialSubmissionData) ??
    (typeof caseDat?.mileage === "number" ? (caseDat.mileage as number) : null);
  const mileage = mileageValue !== null ? `${mileageValue.toLocaleString("de-DE")} km` : UNKNOWN_VALUE;

  const effectiveDealId = m15Detail?.pipedriveDealId ?? data.pipedriveDealId;
  const m15SyncCompleted = m15Detail?.pipedriveSyncStatus?.toLowerCase() === "completed";
  const m15HasAssetActivity = (m15Detail?.assetCount ?? 0) > 0;
  const caseState: CaseState = m15SyncCompleted
    ? "completed"
    : m15Detail && m15HasAssetActivity
      ? "partial"
      : "initial";

  return (
    <div className={ui.page}>
      <div className="mx-auto max-w-7xl px-6 pt-2 pb-8 space-y-6">
        {isFetchingLinked && (
          <div className="flex justify-end">
            <span className="text-xs font-bold text-zinc-400 animate-pulse">Verknüpfte Fälle werden abgeglichen...</span>
          </div>
        )}

        <div className={`${ui.card} p-6 shadow-md`}>
          <div className="flex items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-4">
              <Link
                to={backToList}
                title="Zurück zur Liste"
                className="group flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-400 hover:border-zinc-300 hover:text-[#3ec099] transition-all shadow-sm"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <h1 className="text-xl font-bold text-zinc-900">Fallübersicht</h1>
            </div>
            {effectiveDealId ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-3 px-4 py-1.5 rounded-xl bg-zinc-50 border border-zinc-200/60 shadow-sm">
                  <span className="text-lg font-bold text-zinc-900 leading-none">{effectiveDealId}</span>
                  <CopyButton text={effectiveDealId} />
                </div>
                <a
                  href={pipedriveUrl(effectiveDealId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${ui.button} shrink-0`}
                >
                  In Pipedrive anzeigen
                </a>
              </div>
            ) : null}
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-zinc-100 bg-zinc-50/50 p-5">
              <h2 className="text-sm font-bold text-zinc-900 mb-4 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#3ec099]"></span>
                Fahrzeugdaten
              </h2>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <tbody className="divide-y divide-zinc-100">
                    <tr>
                      <td className="py-2.5 pr-4 text-zinc-500 font-bold text-[10px] uppercase tracking-wider">VIN</td>
                      <td className="py-2.5 font-mono font-bold text-zinc-900">{vin}</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 text-zinc-500 font-bold text-[10px] uppercase tracking-wider">Marke</td>
                      <td className="py-2.5 font-bold text-zinc-700">{make}</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 text-zinc-500 font-bold text-[10px] uppercase tracking-wider">Modell</td>
                      <td className="py-2.5 font-bold text-zinc-700">{model}</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 text-zinc-500 font-bold text-[10px] uppercase tracking-wider">Variante</td>
                      <td className="py-2.5 font-bold text-zinc-700">{variant}</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 text-zinc-500 font-bold text-[10px] uppercase tracking-wider">Erstzulassung</td>
                      <td className="py-2.5 font-bold text-zinc-700">{firstRegistration !== UNKNOWN_VALUE ? formatDate(firstRegistration) : UNKNOWN_VALUE}</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 text-zinc-500 font-bold text-[10px] uppercase tracking-wider">Kilometerstand</td>
                      <td className="py-2.5 font-bold text-zinc-700">{mileage}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-100 bg-zinc-50/50 p-5">
              <h2 className="text-sm font-bold text-zinc-900 mb-4 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#3ec099]"></span>
                Kontaktdaten
              </h2>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <tbody className="divide-y divide-zinc-100">
                    <tr>
                      <td className="py-2.5 pr-4 text-zinc-500 font-bold text-[10px] uppercase tracking-wider">Name</td>
                      <td className="py-2.5 font-bold text-zinc-900">{contactName}</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 text-zinc-500 font-bold text-[10px] uppercase tracking-wider">Email</td>
                      <td className="py-2.5 break-all font-bold text-zinc-700">{contactEmail}</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 text-zinc-500 font-bold text-[10px] uppercase tracking-wider">Telefon</td>
                      <td className="py-2.5 font-bold text-zinc-700">{contactPhone}</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 text-zinc-500 font-bold text-[10px] uppercase tracking-wider">Verkäufertyp</td>
                      <td className="py-2.5 font-bold text-zinc-700">{contactSellerType}</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 text-zinc-500 font-bold text-[10px] uppercase tracking-wider">Fallstatus</td>
                      <td className="py-2.5">
                        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${caseStateBadgeClasses(caseState)}`}>
                          {caseStateLabel(caseState)}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <SubmissionDataViewer title="Fahrzeugzustand & Angaben" rows={submissionRows} />
        <TyresSection tyreRows={tyreRows} />
        <SubmissionDataViewer title="Marketing & Tracking" rows={analyticsRows} defaultCollapsed={true} />

        <div className={`${ui.card} p-6 shadow-md`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-zinc-900">Bilder & Assets ({caseAssets.length})</h2>
            <div className="flex items-center gap-3">
              {caseAssets.length > 0 && (
                <a
                  href={`/api/submissions/${encodeURIComponent(assetSubmissionId)}/download-all`}
                  download
                  className="group flex items-center gap-2 rounded-lg bg-white border border-zinc-200 px-5 py-3 text-sm font-bold text-zinc-600 transition-all shadow-sm hover:border-[#3ec099] hover:text-[#3ec099] hover:bg-zinc-50"
                >
                  <DownloadIcon className="h-4 w-4 transition-transform group-hover:-translate-y-0.5" />
                  Alle herunterladen
                </a>
              )}
              <button
                onClick={() => setIsUploadModalOpen(true)}
                className={`${ui.button} shrink-0 bg-[#3ec099] border-[#3ec099] text-white hover:bg-[#32a884]`}
              >
                Assets hochladen
              </button>
            </div>
          </div>
          
          {isUploadModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm">
              <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-xl">
                <button
                  onClick={() => setIsUploadModalOpen(false)}
                  className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 transition-colors"
                  aria-label="Schließen"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <div className="p-1">
                  <ImageUploadCard
                    submissionId={assetSubmissionId}
                    onUploaded={async () => {
                      await Promise.all([
                        queryClient.invalidateQueries({ queryKey: ["submission"] }),
                        queryClient.invalidateQueries({ queryKey: ["linked-submission"] }),
                      ]);
                      setIsUploadModalOpen(false);
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {caseAssets.length === 0 ? (
            <div className="mt-8 py-12 text-center border-2 border-dashed border-zinc-100 rounded-2xl bg-zinc-50/50">
              <p className="text-sm font-bold text-zinc-400">Es wurden noch keine Assets hochgeladen.</p>
            </div>
          ) : (
            <div className="mt-4">
              <AssetGallery
                assets={caseAssets}
                submissionId={assetSubmissionId}
                onAssetsChanged={async () => {
                  await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ["submission"] }),
                    queryClient.invalidateQueries({ queryKey: ["linked-submission"] }),
                  ]);
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
