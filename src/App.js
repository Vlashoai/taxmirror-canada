import { useState, useMemo, useCallback } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, RadialBarChart, RadialBar } from "recharts";

// ============================================================
// TAX RULES ENGINE - Modular, updatable per tax year
// ============================================================

// --- Federal Tax Rules (2024 tax year) ---
const FEDERAL_TAX_BRACKETS = [
  { min: 0, max: 55867, rate: 0.15 },
  { min: 55867, max: 111733, rate: 0.205 },
  { min: 111733, max: 154906, rate: 0.26 },
  { min: 154906, max: 220000, rate: 0.29 },
  { min: 220000, max: Infinity, rate: 0.33 },
];
const FEDERAL_BASIC_PERSONAL = 15705;
const FEDERAL_BPA_CREDIT_RATE = 0.15;

// CPP/EI Rules (2024)
const CPP_RATE = 0.0595;
const CPP_MAX_PENSIONABLE = 68500;
const CPP_BASIC_EXEMPTION = 3500;
const CPP_MAX_CONTRIBUTION = (CPP_MAX_PENSIONABLE - CPP_BASIC_EXEMPTION) * CPP_RATE; // ~3867

const CPP2_RATE = 0.04;
const CPP2_MAX_PENSIONABLE = 73200;
const CPP2_MAX_CONTRIBUTION = (CPP2_MAX_PENSIONABLE - CPP_MAX_PENSIONABLE) * CPP2_RATE; // ~188

const EI_RATE = 0.0166;
const EI_MAX_INSURABLE = 63200;
const EI_MAX_PREMIUM = EI_MAX_INSURABLE * EI_RATE; // ~1049

// --- Ontario Tax Rules (2024 tax year) ---
const ONTARIO_TAX_BRACKETS = [
  { min: 0, max: 51446, rate: 0.0505 },
  { min: 51446, max: 102894, rate: 0.0915 },
  { min: 102894, max: 150000, rate: 0.1116 },
  { min: 150000, max: 220000, rate: 0.1216 },
  { min: 220000, max: Infinity, rate: 0.1316 },
];
const ONTARIO_BASIC_PERSONAL = 11141;
const ONTARIO_SURTAX_THRESHOLD_1 = 5315;
const ONTARIO_SURTAX_THRESHOLD_2 = 6802;
const ONTARIO_SURTAX_RATE_1 = 0.20;
const ONTARIO_SURTAX_RATE_2 = 0.36;

// --- Alberta Tax Rules (2024) ---
const ALBERTA_TAX_BRACKETS = [
  { min: 0, max: 148269, rate: 0.10 },
  { min: 148269, max: 177922, rate: 0.12 },
  { min: 177922, max: 237230, rate: 0.13 },
  { min: 237230, max: 355845, rate: 0.14 },
  { min: 355845, max: Infinity, rate: 0.15 },
];
const ALBERTA_BASIC_PERSONAL = 21003;

// --- BC Tax Rules (2024) ---
const BC_TAX_BRACKETS = [
  { min: 0, max: 45654, rate: 0.0506 },
  { min: 45654, max: 91310, rate: 0.077 },
  { min: 91310, max: 104835, rate: 0.105 },
  { min: 104835, max: 127299, rate: 0.1229 },
  { min: 127299, max: 172602, rate: 0.147 },
  { min: 172602, max: 240716, rate: 0.168 },
  { min: 240716, max: Infinity, rate: 0.205 },
];
const BC_BASIC_PERSONAL = 11981;

// --- Sales Tax Rules ---
const PROVINCE_SALES_TAX = {
  ON: { type: "HST", rate: 0.13, label: "HST 13%" },
  AB: { type: "GST", rate: 0.05, label: "GST 5% (No PST)" },
  BC: { type: "GST+PST", gst: 0.05, pst: 0.07, rate: 0.12, label: "GST+PST 12%" },
  QC: { type: "GST+QST", gst: 0.05, qst: 0.09975, rate: 0.14975, label: "GST+QST ~15%" },
  MB: { type: "GST+PST", gst: 0.05, pst: 0.07, rate: 0.12, label: "GST+PST 12%" },
  SK: { type: "GST+PST", gst: 0.05, pst: 0.06, rate: 0.11, label: "GST+PST 11%" },
  NS: { type: "HST", rate: 0.15, label: "HST 15%" },
  NB: { type: "HST", rate: 0.15, label: "HST 15%" },
  NL: { type: "HST", rate: 0.15, label: "HST 15%" },
  PEI: { type: "HST", rate: 0.15, label: "HST 15%" },
};

// --- Fuel Tax (estimated, per litre, 2024) ---
const FUEL_TAX = {
  ON: { provincial: 0.147, federal: 0.10, carbon: 0.1761, total: 0.4231 },
  AB: { provincial: 0.09, federal: 0.10, carbon: 0.1761, total: 0.3661 },
  BC: { provincial: 0.179, federal: 0.10, carbon: 0.1761, total: 0.4551 },
};
const DEFAULT_FUEL_TAX = { provincial: 0.147, federal: 0.10, carbon: 0.1761, total: 0.4231 };

// --- Property Tax Rates (estimated annual rate on assessed value) ---
const PROPERTY_TAX_RATES = {
  Toronto: 0.00611,
  Ottawa: 0.01039,
  Hamilton: 0.01185,
  Calgary: 0.00720,
  Edmonton: 0.00958,
  Vancouver: 0.00278,
  Victoria: 0.00415,
  default: 0.01000,
};

// --- Luxury Tax (2022 federal luxury tax) ---
const LUXURY_VEHICLE_THRESHOLD = 100000;
const LUXURY_TAX_RATE_VEHICLE = 0.10; // 10% of amount above threshold OR 20% of full price, whichever is less

// --- Excise Tax Estimates ---
const EXCISE_ALCOHOL_RATE = 0.30; // ~30% embedded excise on retail alcohol
const EXCISE_TOBACCO_RATE = 0.55; // ~55% embedded on cigarettes/tobacco
const EXCISE_CANNABIS_RATE = 0.25; // ~25% estimated

// ============================================================
// CALCULATION ENGINE
// ============================================================

function calcBracketTax(income, brackets) {
  let tax = 0;
  for (const b of brackets) {
    if (income <= b.min) break;
    const taxable = Math.min(income, b.max) - b.min;
    tax += taxable * b.rate;
  }
  return Math.max(0, tax);
}

function calcFederalTax(salary, selfEmployed) {
  const taxableIncome = Math.max(0, salary - FEDERAL_BASIC_PERSONAL);
  const grossTax = calcBracketTax(salary, FEDERAL_TAX_BRACKETS);
  const bpaCredit = FEDERAL_BASIC_PERSONAL * FEDERAL_BPA_CREDIT_RATE;
  return Math.max(0, grossTax - bpaCredit);
}

function calcProvincialTax(salary, province) {
  if (province === "ON") {
    const grossTax = calcBracketTax(salary, ONTARIO_TAX_BRACKETS);
    const bpaCredit = ONTARIO_BASIC_PERSONAL * 0.0505;
    const netTax = Math.max(0, grossTax - bpaCredit);
    // Surtax
    let surtax = 0;
    if (netTax > ONTARIO_SURTAX_THRESHOLD_2) {
      surtax = (netTax - ONTARIO_SURTAX_THRESHOLD_2) * ONTARIO_SURTAX_RATE_2 + (ONTARIO_SURTAX_THRESHOLD_2 - ONTARIO_SURTAX_THRESHOLD_1) * ONTARIO_SURTAX_RATE_1;
    } else if (netTax > ONTARIO_SURTAX_THRESHOLD_1) {
      surtax = (netTax - ONTARIO_SURTAX_THRESHOLD_1) * ONTARIO_SURTAX_RATE_1;
    }
    return netTax + surtax;
  }
  if (province === "AB") {
    const grossTax = calcBracketTax(salary, ALBERTA_TAX_BRACKETS);
    const bpaCredit = ALBERTA_BASIC_PERSONAL * 0.10;
    return Math.max(0, grossTax - bpaCredit);
  }
  if (province === "BC") {
    const grossTax = calcBracketTax(salary, BC_TAX_BRACKETS);
    const bpaCredit = BC_BASIC_PERSONAL * 0.0506;
    return Math.max(0, grossTax - bpaCredit);
  }
  // Default fallback
  return calcBracketTax(salary, FEDERAL_TAX_BRACKETS) * 0.45;
}

function calcCPP(salary, selfEmployed) {
  const contributory = Math.min(Math.max(0, salary - CPP_BASIC_EXEMPTION), CPP_MAX_PENSIONABLE - CPP_BASIC_EXEMPTION);
  const cpp1 = contributory * CPP_RATE;
  const cpp2 = Math.min(Math.max(0, salary - CPP_MAX_PENSIONABLE), CPP2_MAX_PENSIONABLE - CPP_MAX_PENSIONABLE) * CPP2_RATE;
  const multiplier = selfEmployed ? 2 : 1;
  return { cpp1: Math.min(cpp1, CPP_MAX_CONTRIBUTION) * multiplier, cpp2: Math.min(cpp2, CPP2_MAX_CONTRIBUTION) * multiplier };
}

function calcEI(salary, selfEmployed) {
  if (selfEmployed) return 0;
  return Math.min(salary, EI_MAX_INSURABLE) * EI_RATE;
}

function calcSalesTax(spending, province) {
  const salesTaxRule = PROVINCE_SALES_TAX[province] || PROVINCE_SALES_TAX["ON"];
  const rate = salesTaxRule.rate;
  const results = {};
  // Groceries zero-rated for basic groceries (GST/HST exemption)
  results.groceries = { tax: 0, rate: 0, note: "Zero-rated basic groceries", confidence: "High" };
  results.restaurants = { tax: spending.restaurants * 12 * rate, rate, note: "Fully taxable", confidence: "High" };
  results.shopping = { tax: spending.shopping * 12 * rate, rate, note: "Fully taxable", confidence: "High" };
  results.phoneInternet = { tax: spending.phoneInternet * 12 * rate, rate, note: "Fully taxable", confidence: "High" };
  results.subscriptions = { tax: spending.subscriptions * 12 * rate, rate, note: "Taxable (streaming, etc.)", confidence: "High" };
  results.alcohol = { tax: spending.alcohol * 12 * rate, rate, note: "Also subject to excise", confidence: "Medium" };
  results.tobaccoCannabis = { tax: spending.tobaccoCannabis * 12 * rate, rate, note: "Also subject to excise", confidence: "Medium" };
  results.otherPurchases = { tax: spending.otherPurchases * rate, rate, note: "Annual taxable purchases", confidence: "High" };
  return results;
}

function calcFuelTax(litresPerMonth, province) {
  const fuelRule = FUEL_TAX[province] || DEFAULT_FUEL_TAX;
  const annualLitres = litresPerMonth * 12;
  return {
    annualTax: annualLitres * fuelRule.total,
    breakdown: fuelRule,
    confidence: "Medium",
  };
}

function calcExciseTax(spending) {
  const alcoholExcise = spending.alcohol * 12 * EXCISE_ALCOHOL_RATE;
  const tobaccoExcise = spending.tobaccoCannabis * 12 * EXCISE_TOBACCO_RATE;
  return {
    alcohol: { tax: alcoholExcise, rate: EXCISE_ALCOHOL_RATE, confidence: "Estimated" },
    tobacco: { tax: tobaccoExcise, rate: EXCISE_TOBACCO_RATE, confidence: "Estimated" },
  };
}

function calcPropertyTax(homeValue, city, isHomeowner) {
  if (!isHomeowner || !homeValue) return 0;
  const rate = PROPERTY_TAX_RATES[city] || PROPERTY_TAX_RATES.default;
  return homeValue * rate;
}

function calcLuxuryTax(vehicleAmount, luxuryAmount) {
  let vehicleLuxuryTax = 0;
  if (vehicleAmount > LUXURY_VEHICLE_THRESHOLD) {
    const method1 = (vehicleAmount - LUXURY_VEHICLE_THRESHOLD) * LUXURY_TAX_RATE_VEHICLE;
    const method2 = vehicleAmount * 0.20;
    vehicleLuxuryTax = Math.min(method1, method2);
  }
  let otherLuxuryTax = 0;
  if (luxuryAmount > 250000) {
    otherLuxuryTax = Math.min((luxuryAmount - 250000) * 0.10, luxuryAmount * 0.20);
  }
  return { vehicleLuxuryTax, otherLuxuryTax, total: vehicleLuxuryTax + otherLuxuryTax };
}

function calcVehicleSalesTax(vehicleAmount, province) {
  const salesTaxRule = PROVINCE_SALES_TAX[province] || PROVINCE_SALES_TAX["ON"];
  return vehicleAmount * salesTaxRule.rate;
}

function runFullCalculation(profile) {
  const {
    salary, province, city, employmentType, isHomeowner,
    spending, homeValue, vehicleAmount, luxuryAmount,
  } = profile;

  const isSE = employmentType === "self-employed";

  // Direct taxes
  const federalTax = calcFederalTax(salary, isSE);
  const provincialTax = calcProvincialTax(salary, province);
  const { cpp1, cpp2 } = calcCPP(salary, isSE);
  const ei = calcEI(salary, isSE);
  const totalPayroll = cpp1 + cpp2 + ei;
  const totalDirectTax = federalTax + provincialTax + totalPayroll;

  // Consumption taxes
  const salesTaxResults = calcSalesTax(spending, province);
  const totalSalesTax = Object.values(salesTaxResults).reduce((sum, r) => sum + r.tax, 0);

  // Fuel tax
  const fuelTaxResult = calcFuelTax(spending.litresPerMonth || 0, province);
  const totalFuelTax = fuelTaxResult.annualTax;

  // Excise
  const exciseResult = calcExciseTax(spending);
  const totalExcise = exciseResult.alcohol.tax + exciseResult.tobacco.tax;

  // Property tax
  const propertyTax = calcPropertyTax(homeValue, city, isHomeowner);

  // Luxury + vehicle taxes
  const luxuryResult = calcLuxuryTax(vehicleAmount || 0, luxuryAmount || 0);
  const vehicleSalesTax = calcVehicleSalesTax(vehicleAmount || 0, province);

  const totalOwnershipTax = propertyTax + luxuryResult.total + vehicleSalesTax;
  const totalConsumptionTax = totalSalesTax + totalFuelTax + totalExcise;

  const totalTaxBurden = totalDirectTax + totalConsumptionTax + totalOwnershipTax;
  const effectiveRate = salary > 0 ? (totalTaxBurden / salary) * 100 : 0;

  const annualRent = (spending.rent || 0) * 12;
  const annualMortgage = (spending.mortgage || 0) * 12;
  const annualGroceries = spending.groceries * 12;
  const majorExpenses = annualRent + annualMortgage + annualGroceries;
  const disposableIncome = salary - totalTaxBurden - majorExpenses;

  return {
    salary,
    federalTax, provincialTax, cpp1, cpp2, ei, totalPayroll, totalDirectTax,
    salesTaxResults, totalSalesTax, fuelTaxResult, totalFuelTax,
    exciseResult, totalExcise, propertyTax, luxuryResult, vehicleSalesTax,
    totalOwnershipTax, totalConsumptionTax,
    totalTaxBurden, effectiveRate, disposableIncome, majorExpenses,
  };
}

// ============================================================
// PROVINCE LABELS
// ============================================================
const PROVINCES = [
  { code: "ON", name: "Ontario" },
  { code: "AB", name: "Alberta" },
  { code: "BC", name: "British Columbia" },
  { code: "QC", name: "Quebec" },
  { code: "MB", name: "Manitoba" },
  { code: "SK", name: "Saskatchewan" },
  { code: "NS", name: "Nova Scotia" },
  { code: "NB", name: "New Brunswick" },
  { code: "NL", name: "Newfoundland" },
  { code: "PEI", name: "PEI" },
];

const CITIES = ["Toronto", "Ottawa", "Hamilton", "Mississauga", "Brampton", "Calgary", "Edmonton", "Vancouver", "Victoria", "Montreal", "Other"];

// ============================================================
// DEFAULT DEMO PROFILE
// ============================================================
const DEFAULT_PROFILE = {
  salary: 95000,
  province: "ON",
  city: "Toronto",
  employmentType: "employee",
  householdType: "single",
  isHomeowner: true,
  homeValue: 750000,
  vehicleAmount: 0,
  luxuryAmount: 0,
  spending: {
    groceries: 600,
    restaurants: 400,
    gas: 200,
    litresPerMonth: 60,
    shopping: 300,
    phoneInternet: 120,
    subscriptions: 80,
    alcohol: 100,
    tobaccoCannabis: 50,
    rent: 0,
    mortgage: 2800,
    otherPurchases: 2000,
  },
};

// ============================================================
// COLOR PALETTE
// ============================================================
const COLORS = {
  primary: "#1E5FAD",
  primaryLight: "#3B82F6",
  primaryLighter: "#93C5FD",
  accent: "#06B6D4",
  accentLight: "#A5F3FC",
  bg: "#F0F7FF",
  surface: "#FFFFFF",
  card: "#F8FBFF",
  border: "#DBEAFE",
  text: "#0F172A",
  textMuted: "#475569",
  textLight: "#94A3B8",
  positive: "#059669",
  warning: "#D97706",
  danger: "#DC2626",
  chart: ["#1E5FAD", "#3B82F6", "#06B6D4", "#0EA5E9", "#38BDF8", "#7DD3FC", "#BAE6FD"],
};

const fmt = (n) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n || 0);
const fmtPct = (n) => `${(n || 0).toFixed(1)}%`;

// ============================================================
// COMPONENTS
// ============================================================

function Badge({ type }) {
  const map = {
    "High": { bg: "#DCFCE7", color: "#166534", text: "High Confidence" },
    "Medium": { bg: "#FEF3C7", color: "#92400E", text: "Medium Confidence" },
    "Estimated": { bg: "#FEE2E2", color: "#991B1B", text: "Estimated" },
  };
  const s = map[type] || map["Estimated"];
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99, letterSpacing: "0.05em", textTransform: "uppercase" }}>
      {s.text}
    </span>
  );
}

function Card({ children, style = {} }) {
  return (
    <div style={{
      background: COLORS.surface,
      borderRadius: 16,
      border: `1px solid ${COLORS.border}`,
      boxShadow: "0 2px 12px rgba(30,95,173,0.07)",
      padding: 24,
      ...style
    }}>
      {children}
    </div>
  );
}

function MetricCard({ label, value, sub, color, icon }) {
  return (
    <div style={{
      background: COLORS.surface,
      borderRadius: 16,
      border: `1px solid ${COLORS.border}`,
      boxShadow: "0 2px 12px rgba(30,95,173,0.07)",
      padding: "20px 22px",
      display: "flex",
      flexDirection: "column",
      gap: 6,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {icon && <span style={{ fontSize: 18 }}>{icon}</span>}
        <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: color || COLORS.text, letterSpacing: "-0.02em" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: COLORS.textLight }}>{sub}</div>}
    </div>
  );
}

function SectionTitle({ children, sub }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h2 style={{ fontSize: 20, fontWeight: 800, color: COLORS.text, margin: 0 }}>{children}</h2>
      {sub && <p style={{ fontSize: 13, color: COLORS.textMuted, margin: "4px 0 0" }}>{sub}</p>}
    </div>
  );
}

function TaxRow({ label, value, sub, confidence, indent }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "10px 0", borderBottom: `1px solid ${COLORS.border}`,
      paddingLeft: indent ? 16 : 0,
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: indent ? 400 : 600, color: COLORS.text }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: COLORS.textLight }}>{sub}</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {confidence && <Badge type={confidence} />}
        <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.primary, minWidth: 90, textAlign: "right" }}>{fmt(value)}</div>
      </div>
    </div>
  );
}

// ============================================================
// FORM COMPONENT
// ============================================================
function ProfileForm({ profile, setProfile }) {
  const upd = (key, val) => setProfile(p => ({ ...p, [key]: val }));
  const updSpend = (key, val) => setProfile(p => ({ ...p, spending: { ...p.spending, [key]: parseFloat(val) || 0 } }));

  const inputStyle = {
    width: "100%", padding: "9px 12px", borderRadius: 10,
    border: `1.5px solid ${COLORS.border}`, fontSize: 14,
    background: COLORS.card, color: COLORS.text,
    outline: "none", boxSizing: "border-box",
    fontFamily: "inherit",
  };
  const labelStyle = { fontSize: 12, fontWeight: 600, color: COLORS.textMuted, display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" };
  const fieldWrap = { marginBottom: 14 };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <div style={{ gridColumn: "1/-1" }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: COLORS.primary, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>📋 Profile</div>
      </div>

      <div style={fieldWrap}>
        <label style={labelStyle}>Annual Salary</label>
        <input style={inputStyle} type="number" value={profile.salary} onChange={e => upd("salary", parseFloat(e.target.value) || 0)} />
      </div>

      <div style={fieldWrap}>
        <label style={labelStyle}>Province</label>
        <select style={inputStyle} value={profile.province} onChange={e => upd("province", e.target.value)}>
          {PROVINCES.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
        </select>
      </div>

      <div style={fieldWrap}>
        <label style={labelStyle}>City</label>
        <select style={inputStyle} value={profile.city} onChange={e => upd("city", e.target.value)}>
          {CITIES.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>

      <div style={fieldWrap}>
        <label style={labelStyle}>Employment Type</label>
        <select style={inputStyle} value={profile.employmentType} onChange={e => upd("employmentType", e.target.value)}>
          <option value="employee">Employee</option>
          <option value="self-employed">Self-Employed</option>
        </select>
      </div>

      <div style={{ gridColumn: "1/-1", height: 1, background: COLORS.border, margin: "4px 0 10px" }} />
      <div style={{ gridColumn: "1/-1" }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: COLORS.primary, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>🏠 Housing</div>
      </div>

      <div style={fieldWrap}>
        <label style={labelStyle}>I am a...</label>
        <select style={inputStyle} value={profile.isHomeowner ? "owner" : "renter"} onChange={e => upd("isHomeowner", e.target.value === "owner")}>
          <option value="owner">Homeowner</option>
          <option value="renter">Renter</option>
        </select>
      </div>

      {profile.isHomeowner ? (
        <>
          <div style={fieldWrap}>
            <label style={labelStyle}>Home Value ($)</label>
            <input style={inputStyle} type="number" value={profile.homeValue} onChange={e => upd("homeValue", parseFloat(e.target.value) || 0)} />
          </div>
          <div style={fieldWrap}>
            <label style={labelStyle}>Monthly Mortgage ($)</label>
            <input style={inputStyle} type="number" value={profile.spending.mortgage} onChange={e => updSpend("mortgage", e.target.value)} />
          </div>
        </>
      ) : (
        <div style={fieldWrap}>
          <label style={labelStyle}>Monthly Rent ($)</label>
          <input style={inputStyle} type="number" value={profile.spending.rent} onChange={e => updSpend("rent", e.target.value)} />
        </div>
      )}

      <div style={{ gridColumn: "1/-1", height: 1, background: COLORS.border, margin: "4px 0 10px" }} />
      <div style={{ gridColumn: "1/-1" }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: COLORS.primary, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>🛒 Monthly Spending</div>
      </div>

      {[
        ["groceries", "Groceries ($)"],
        ["restaurants", "Restaurants / Takeout ($)"],
        ["gas", "Gas / Fuel ($)"],
        ["litresPerMonth", "Litres of Fuel/Month"],
        ["shopping", "Shopping ($)"],
        ["phoneInternet", "Phone / Internet ($)"],
        ["subscriptions", "Subscriptions ($)"],
        ["alcohol", "Alcohol ($)"],
        ["tobaccoCannabis", "Tobacco / Cannabis ($)"],
      ].map(([key, label]) => (
        <div key={key} style={fieldWrap}>
          <label style={labelStyle}>{label}</label>
          <input style={inputStyle} type="number" value={profile.spending[key]} onChange={e => updSpend(key, e.target.value)} />
        </div>
      ))}

      <div style={{ gridColumn: "1/-1", height: 1, background: COLORS.border, margin: "4px 0 10px" }} />
      <div style={{ gridColumn: "1/-1" }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: COLORS.primary, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>🚗 Annual Purchases</div>
      </div>

      <div style={fieldWrap}>
        <label style={labelStyle}>Vehicle Purchase ($)</label>
        <input style={inputStyle} type="number" value={profile.vehicleAmount} onChange={e => upd("vehicleAmount", parseFloat(e.target.value) || 0)} />
      </div>

      <div style={fieldWrap}>
        <label style={labelStyle}>Luxury Purchase ($)</label>
        <input style={inputStyle} type="number" value={profile.luxuryAmount} onChange={e => upd("luxuryAmount", parseFloat(e.target.value) || 0)} />
      </div>

      <div style={fieldWrap}>
        <label style={labelStyle}>Other Taxable Purchases ($)</label>
        <input style={inputStyle} type="number" value={profile.spending.otherPurchases} onChange={e => updSpend("otherPurchases", e.target.value)} />
      </div>
    </div>
  );
}

// ============================================================
// OVERVIEW PAGE
// ============================================================
function OverviewPage({ calc, profile }) {
  const c = calc;
  const workingHours = 2000;
  const workingDays = 250;

  const donutData = [
    { name: "Federal Tax", value: Math.round(c.federalTax) },
    { name: "Provincial Tax", value: Math.round(c.provincialTax) },
    { name: "CPP / EI", value: Math.round(c.totalPayroll) },
    { name: "Sales Tax", value: Math.round(c.totalSalesTax) },
    { name: "Fuel & Excise", value: Math.round(c.totalFuelTax + c.totalExcise) },
    { name: "Property Tax", value: Math.round(c.propertyTax) },
    { name: "Luxury / Vehicle", value: Math.round(c.totalOwnershipTax - c.propertyTax) },
  ].filter(d => d.value > 0);

  const stackData = [
    {
      name: "Annual",
      "Direct Taxes": Math.round(c.totalDirectTax),
      "Consumption Taxes": Math.round(c.totalConsumptionTax),
      "Ownership Taxes": Math.round(c.totalOwnershipTax),
    }
  ];

  // Insights
  const insights = [];
  if (c.totalDirectTax > c.totalConsumptionTax * 2) insights.push("💡 Your largest tax category is income & payroll tax — common at your income level.");
  if (c.totalSalesTax > 5000) insights.push("🛍️ Your spending taxes are significant — reducing restaurant and shopping spend could help.");
  if (profile.isHomeowner) insights.push("🏠 Property taxes add to your tax burden. Renters avoid this but face other costs.");
  if (profile.employmentType === "self-employed") insights.push("📊 As self-employed, you pay both employer and employee CPP — nearly double the rate.");
  if (c.effectiveRate > 35) insights.push("⚠️ Your total effective tax rate exceeds 35%. Consider tax-sheltered savings (RRSP, TFSA).");
  if (c.totalFuelTax > 1000) insights.push("⛽ Fuel taxes are notable. Carbon tax is embedded in your fuel cost.");

  return (
    <div>
      {/* Disclaimer */}
      <div style={{ background: "#EFF6FF", border: `1px solid ${COLORS.primaryLighter}`, borderRadius: 10, padding: "10px 16px", marginBottom: 24, fontSize: 12, color: COLORS.primary }}>
        <strong>⚖️ Disclaimer:</strong> TaxMirror Canada provides estimated tax insights for educational and financial awareness purposes only. It does not provide legal, accounting, or tax filing advice.
      </div>

      {/* Key Metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
        <MetricCard label="Gross Income" value={fmt(c.salary)} icon="💰" color={COLORS.primary} />
        <MetricCard label="Total Tax Burden" value={fmt(c.totalTaxBurden)} sub={fmtPct(c.effectiveRate) + " of income"} icon="📊" color={COLORS.danger} />
        <MetricCard label="Net Disposable" value={fmt(c.disposableIncome)} sub="After taxes & major expenses" icon="✅" color={COLORS.positive} />
        <MetricCard label="Tax Per Month" value={fmt(c.totalTaxBurden / 12)} sub={`${fmt(c.totalTaxBurden / workingDays)}/day`} icon="📅" color={COLORS.warning} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 28 }}>
        <MetricCard label="Direct Taxes" value={fmt(c.totalDirectTax)} icon="🏛️" color={COLORS.primary} />
        <MetricCard label="Consumption Taxes" value={fmt(c.totalConsumptionTax)} icon="🛒" color={COLORS.accent} />
        <MetricCard label="Ownership Taxes" value={fmt(c.totalOwnershipTax)} icon="🏠" color="#7C3AED" />
        <MetricCard label="Tax Per Hour" value={fmt(c.totalTaxBurden / workingHours)} sub="Based on 2000 working hrs" icon="⏱️" color={COLORS.textMuted} />
      </div>

      {/* Charts */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
        <Card>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16, color: COLORS.text }}>Tax Composition</div>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={donutData} cx="50%" cy="50%" innerRadius={65} outerRadius={110} dataKey="value" paddingAngle={2}>
                {donutData.map((_, i) => <Cell key={i} fill={COLORS.chart[i % COLORS.chart.length]} />)}
              </Pie>
              <Tooltip formatter={v => fmt(v)} />
              <Legend iconSize={10} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16, color: COLORS.text }}>Tax Layers Breakdown</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={stackData} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
              <XAxis dataKey="name" hide />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={v => fmt(v)} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Direct Taxes" fill={COLORS.primary} radius={[4, 4, 0, 0]} />
              <Bar dataKey="Consumption Taxes" fill={COLORS.accent} radius={[4, 4, 0, 0]} />
              <Bar dataKey="Ownership Taxes" fill="#7C3AED" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Insights */}
      <Card>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14, color: COLORS.text }}>🔍 Tax Insights</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {insights.map((ins, i) => (
            <div key={i} style={{ background: COLORS.bg, borderRadius: 10, padding: "10px 14px", fontSize: 13, color: COLORS.text, borderLeft: `3px solid ${COLORS.primaryLight}` }}>
              {ins}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ============================================================
// TAX LAYERS PAGE
// ============================================================
function TaxLayersPage({ calc: c }) {
  const [expanded, setExpanded] = useState({ direct: true, consumption: true, ownership: true });

  const toggle = key => setExpanded(e => ({ ...e, [key]: !e[key] }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Direct Taxes */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => toggle("direct")}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: COLORS.text }}>🏛️ Direct Taxes</div>
            <div style={{ fontSize: 12, color: COLORS.textMuted }}>Income tax, payroll deductions</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 20, color: COLORS.primary }}>{fmt(c.totalDirectTax)}</div>
            <span style={{ fontSize: 18 }}>{expanded.direct ? "▲" : "▼"}</span>
          </div>
        </div>
        {expanded.direct && (
          <div style={{ marginTop: 16 }}>
            <TaxRow label="Federal Income Tax" value={c.federalTax} confidence="High" sub="Progressive federal brackets" />
            <TaxRow label="Provincial Income Tax" value={c.provincialTax} confidence="High" sub="Provincial brackets + surtax if applicable" indent />
            <TaxRow label="CPP Contributions" value={c.cpp1} confidence="High" sub="Canada Pension Plan (Tier 1)" indent />
            <TaxRow label="CPP2 Contributions" value={c.cpp2} confidence="High" sub="Enhanced CPP (Tier 2, 2024+)" indent />
            <TaxRow label="EI Premiums" value={c.ei} confidence="High" sub={c.ei === 0 ? "Waived for self-employed" : "Employment Insurance"} indent />
          </div>
        )}
      </Card>

      {/* Consumption Taxes */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => toggle("consumption")}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: COLORS.text }}>🛒 Consumption Taxes</div>
            <div style={{ fontSize: 12, color: COLORS.textMuted }}>Sales tax, fuel tax, excise duties</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 20, color: COLORS.accent }}>{fmt(c.totalConsumptionTax)}</div>
            <span style={{ fontSize: 18 }}>{expanded.consumption ? "▲" : "▼"}</span>
          </div>
        </div>
        {expanded.consumption && (
          <div style={{ marginTop: 16 }}>
            <TaxRow label="Groceries (Sales Tax)" value={c.salesTaxResults.groceries?.tax} confidence="High" sub="Zero-rated basic groceries — no HST/GST" indent />
            <TaxRow label="Restaurants & Takeout" value={c.salesTaxResults.restaurants?.tax} confidence="High" sub="Fully taxable at provincial rate" indent />
            <TaxRow label="Shopping" value={c.salesTaxResults.shopping?.tax} confidence="High" sub="General merchandise, taxable" indent />
            <TaxRow label="Phone & Internet" value={c.salesTaxResults.phoneInternet?.tax} confidence="High" sub="Taxable services" indent />
            <TaxRow label="Subscriptions" value={c.salesTaxResults.subscriptions?.tax} confidence="High" sub="Streaming, software, etc." indent />
            <TaxRow label="Alcohol (Sales Tax)" value={c.salesTaxResults.alcohol?.tax} confidence="Medium" sub="Taxable at standard rate" indent />
            <TaxRow label="Tobacco / Cannabis (Sales Tax)" value={c.salesTaxResults.tobaccoCannabis?.tax} confidence="Medium" sub="Standard rate" indent />
            <TaxRow label="Other Taxable Purchases" value={c.salesTaxResults.otherPurchases?.tax} confidence="High" sub="Annual misc purchases" indent />
            <TaxRow label="Fuel Tax (Provincial + Federal + Carbon)" value={c.totalFuelTax} confidence="Medium" sub={`Based on estimated litres × ${fmt(DEFAULT_FUEL_TAX.total)}/L total rate`} />
            <TaxRow label="Alcohol Excise Duties" value={c.exciseResult.alcohol.tax} confidence="Estimated" sub="~30% embedded excise on retail alcohol" indent />
            <TaxRow label="Tobacco / Cannabis Excise" value={c.exciseResult.tobacco.tax} confidence="Estimated" sub="~55% estimated embedded excise on tobacco" indent />
          </div>
        )}
      </Card>

      {/* Ownership Taxes */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => toggle("ownership")}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: COLORS.text }}>🏠 Ownership & Asset Taxes</div>
            <div style={{ fontSize: 12, color: COLORS.textMuted }}>Property, vehicle, luxury taxes</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 20, color: "#7C3AED" }}>{fmt(c.totalOwnershipTax)}</div>
            <span style={{ fontSize: 18 }}>{expanded.ownership ? "▲" : "▼"}</span>
          </div>
        </div>
        {expanded.ownership && (
          <div style={{ marginTop: 16 }}>
            <TaxRow label="Property Tax" value={c.propertyTax} confidence={c.propertyTax > 0 ? "Medium" : "High"} sub={c.propertyTax > 0 ? "Estimated based on city average mill rate" : "Renter — no property tax"} />
            <TaxRow label="Vehicle Purchase Tax (HST)" value={c.vehicleSalesTax} confidence="High" sub="Sales tax on vehicle purchase price" indent />
            <TaxRow label="Federal Luxury Tax" value={c.luxuryResult.vehicleLuxuryTax + c.luxuryResult.otherLuxuryTax} confidence="High" sub="Applies to vehicles >$100k, aircraft, boats" indent />
          </div>
        )}
      </Card>

      {/* Total */}
      <div style={{ background: `linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.primaryLight} 100%)`, borderRadius: 16, padding: "24px 28px", color: "white" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24 }}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em" }}>Total Tax Burden</div>
            <div style={{ fontSize: 32, fontWeight: 900, letterSpacing: "-0.03em" }}>{fmt(c.totalTaxBurden)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, opacity: 0.8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em" }}>Effective Rate</div>
            <div style={{ fontSize: 32, fontWeight: 900, letterSpacing: "-0.03em" }}>{fmtPct(c.effectiveRate)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, opacity: 0.8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em" }}>Disposable Income</div>
            <div style={{ fontSize: 32, fontWeight: 900, letterSpacing: "-0.03em" }}>{fmt(c.disposableIncome)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SPENDING TAX ANALYZER
// ============================================================
function SpendingAnalyzerPage({ calc: c, profile }) {
  const salesTaxRule = PROVINCE_SALES_TAX[profile.province] || PROVINCE_SALES_TAX["ON"];

  const rows = [
    { cat: "Groceries", monthly: profile.spending.groceries, rate: 0, tax: 0, confidence: "High", note: "Zero-rated basic groceries" },
    { cat: "Restaurants / Takeout", monthly: profile.spending.restaurants, rate: salesTaxRule.rate, tax: c.salesTaxResults.restaurants?.tax, confidence: "High", note: "Fully taxable" },
    { cat: "Gas / Fuel", monthly: profile.spending.gas, rate: null, tax: c.totalFuelTax, confidence: "Medium", note: "Includes carbon, federal & provincial fuel taxes on litres" },
    { cat: "Shopping", monthly: profile.spending.shopping, rate: salesTaxRule.rate, tax: c.salesTaxResults.shopping?.tax, confidence: "High", note: "General merchandise" },
    { cat: "Phone / Internet", monthly: profile.spending.phoneInternet, rate: salesTaxRule.rate, tax: c.salesTaxResults.phoneInternet?.tax, confidence: "High", note: "Taxable service" },
    { cat: "Subscriptions", monthly: profile.spending.subscriptions, rate: salesTaxRule.rate, tax: c.salesTaxResults.subscriptions?.tax, confidence: "High", note: "Streaming, apps" },
    { cat: "Alcohol", monthly: profile.spending.alcohol, rate: salesTaxRule.rate, tax: (c.salesTaxResults.alcohol?.tax || 0) + c.exciseResult.alcohol.tax, confidence: "Medium", note: "Sales tax + ~30% excise estimate" },
    { cat: "Tobacco / Cannabis", monthly: profile.spending.tobaccoCannabis, rate: salesTaxRule.rate, tax: (c.salesTaxResults.tobaccoCannabis?.tax || 0) + c.exciseResult.tobacco.tax, confidence: "Estimated", note: "Sales tax + ~55% excise estimate" },
  ];

  const totalTax = rows.reduce((s, r) => s + (r.tax || 0), 0);

  return (
    <div>
      <SectionTitle sub={`Showing ${salesTaxRule.label} for your province`}>Spending Tax Analyzer</SectionTitle>
      <Card>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: COLORS.bg }}>
                {["Category", "Monthly Spend", "Annual Spend", "Tax Rate", "Annual Tax Paid", "Confidence", "Notes"].map(h => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `2px solid ${COLORS.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                  <td style={{ padding: "12px 14px", fontWeight: 600, color: COLORS.text }}>{r.cat}</td>
                  <td style={{ padding: "12px 14px", color: COLORS.textMuted }}>{fmt(r.monthly)}</td>
                  <td style={{ padding: "12px 14px", color: COLORS.textMuted }}>{fmt(r.monthly * 12)}</td>
                  <td style={{ padding: "12px 14px", color: COLORS.textMuted }}>{r.rate !== null ? fmtPct(r.rate * 100) : "varies"}</td>
                  <td style={{ padding: "12px 14px", fontWeight: 700, color: COLORS.primary }}>{fmt(r.tax)}</td>
                  <td style={{ padding: "12px 14px" }}><Badge type={r.confidence} /></td>
                  <td style={{ padding: "12px 14px", color: COLORS.textLight, fontSize: 12 }}>{r.note}</td>
                </tr>
              ))}
              <tr style={{ background: COLORS.bg, fontWeight: 800 }}>
                <td colSpan={4} style={{ padding: "12px 14px", color: COLORS.text }}>Total Consumption Tax</td>
                <td style={{ padding: "12px 14px", color: COLORS.primary, fontWeight: 800, fontSize: 16 }}>{fmt(totalTax)}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ============================================================
// PROVINCE COMPARISON
// ============================================================
function ProvinceComparisonPage({ profile }) {
  const [compareProvince, setCompareProvince] = useState("AB");

  const current = useMemo(() => runFullCalculation(profile), [profile]);
  const other = useMemo(() => runFullCalculation({ ...profile, province: compareProvince }), [profile, compareProvince]);

  const currentName = PROVINCES.find(p => p.code === profile.province)?.name || profile.province;
  const otherName = PROVINCES.find(p => p.code === compareProvince)?.name || compareProvince;

  const diff = other.totalTaxBurden - current.totalTaxBurden;

  const compareRows = [
    { label: "Federal Income Tax", a: current.federalTax, b: other.federalTax },
    { label: "Provincial Income Tax", a: current.provincialTax, b: other.provincialTax },
    { label: "CPP + EI", a: current.totalPayroll, b: other.totalPayroll },
    { label: "Sales Tax (Consumption)", a: current.totalSalesTax, b: other.totalSalesTax },
    { label: "Fuel Tax", a: current.totalFuelTax, b: other.totalFuelTax },
    { label: "Property Tax", a: current.propertyTax, b: other.propertyTax },
    { label: "Total Tax Burden", a: current.totalTaxBurden, b: other.totalTaxBurden, bold: true },
    { label: "Effective Rate", a: current.effectiveRate, b: other.effectiveRate, pct: true },
    { label: "Disposable Income", a: current.disposableIncome, b: other.disposableIncome, bold: true },
  ];

  const chartData = [
    { name: "Direct", [currentName]: Math.round(current.totalDirectTax), [otherName]: Math.round(other.totalDirectTax) },
    { name: "Consumption", [currentName]: Math.round(current.totalConsumptionTax), [otherName]: Math.round(other.totalConsumptionTax) },
    { name: "Ownership", [currentName]: Math.round(current.totalOwnershipTax), [otherName]: Math.round(other.totalOwnershipTax) },
    { name: "Total", [currentName]: Math.round(current.totalTaxBurden), [otherName]: Math.round(other.totalTaxBurden) },
  ];

  return (
    <div>
      <SectionTitle sub="Compare your tax burden across provinces">Province Comparison</SectionTitle>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: COLORS.text }}>Compare with:</div>
        <select
          value={compareProvince}
          onChange={e => setCompareProvince(e.target.value)}
          style={{ padding: "8px 14px", borderRadius: 10, border: `1.5px solid ${COLORS.border}`, fontSize: 14, background: COLORS.surface, color: COLORS.text, fontFamily: "inherit" }}
        >
          {PROVINCES.filter(p => p.code !== profile.province).map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
        </select>
        {diff !== 0 && (
          <div style={{ padding: "6px 14px", borderRadius: 99, background: diff < 0 ? "#DCFCE7" : "#FEE2E2", color: diff < 0 ? COLORS.positive : COLORS.danger, fontWeight: 700, fontSize: 13 }}>
            {diff < 0 ? `You'd save ${fmt(Math.abs(diff))} moving to ${otherName}` : `You'd pay ${fmt(diff)} more in ${otherName}`}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
        <Card>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Side-by-Side Comparison</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: COLORS.textMuted, textTransform: "uppercase" }}>Category</th>
                  <th style={{ padding: "8px 12px", textAlign: "right", fontSize: 11, fontWeight: 700, color: COLORS.primary, textTransform: "uppercase" }}>{currentName}</th>
                  <th style={{ padding: "8px 12px", textAlign: "right", fontSize: 11, fontWeight: 700, color: COLORS.accent, textTransform: "uppercase" }}>{otherName}</th>
                </tr>
              </thead>
              <tbody>
                {compareRows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${COLORS.border}`, background: r.bold ? COLORS.bg : "transparent" }}>
                    <td style={{ padding: "10px 12px", fontWeight: r.bold ? 700 : 400, color: COLORS.text }}>{r.label}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: r.bold ? 800 : 600, color: COLORS.primary }}>
                      {r.pct ? fmtPct(r.a) : fmt(r.a)}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: r.bold ? 800 : 600, color: COLORS.accent }}>
                      {r.pct ? fmtPct(r.b) : fmt(r.b)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Visual Comparison</div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={v => fmt(v)} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey={currentName} fill={COLORS.primary} radius={[4, 4, 0, 0]} />
              <Bar dataKey={otherName} fill={COLORS.accent} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}

// ============================================================
// WHAT-IF SIMULATOR
// ============================================================
function WhatIfPage({ profile, calc: baseCalc }) {
  const [simProfile, setSimProfile] = useState(profile);
  const simCalc = useMemo(() => runFullCalculation(simProfile), [simProfile]);

  const diff = simCalc.totalTaxBurden - baseCalc.totalTaxBurden;
  const disposDiff = simCalc.disposableIncome - baseCalc.disposableIncome;

  const presets = [
    { label: "🌾 Move to Alberta", apply: p => ({ ...p, province: "AB", city: "Calgary" }) },
    { label: "💰 Earn $120k", apply: p => ({ ...p, salary: 120000 }) },
    { label: "💰 Earn $60k", apply: p => ({ ...p, salary: 60000 }) },
    { label: "🍽️ Halve dining out", apply: p => ({ ...p, spending: { ...p.spending, restaurants: p.spending.restaurants / 2 } }) },
    { label: "🛍️ Cut shopping 50%", apply: p => ({ ...p, spending: { ...p.spending, shopping: p.spending.shopping / 2 } }) },
    { label: "🚗 Buy a $120k car", apply: p => ({ ...p, vehicleAmount: 120000 }) },
    { label: "🏠 Switch to renting", apply: p => ({ ...p, isHomeowner: false, homeValue: 0, spending: { ...p.spending, rent: 2500, mortgage: 0 } }) },
    { label: "💼 Go self-employed", apply: p => ({ ...p, employmentType: "self-employed" }) },
  ];

  const compData = [
    { name: "Base", Direct: Math.round(baseCalc.totalDirectTax), Consumption: Math.round(baseCalc.totalConsumptionTax), Ownership: Math.round(baseCalc.totalOwnershipTax) },
    { name: "Simulated", Direct: Math.round(simCalc.totalDirectTax), Consumption: Math.round(simCalc.totalConsumptionTax), Ownership: Math.round(simCalc.totalOwnershipTax) },
  ];

  return (
    <div>
      <SectionTitle sub="Change variables and instantly see the tax impact">What-If Simulator</SectionTitle>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
        {presets.map(p => (
          <button key={p.label} onClick={() => setSimProfile(p.apply(profile))} style={{
            padding: "8px 16px", borderRadius: 99, border: `1.5px solid ${COLORS.border}`,
            background: COLORS.surface, cursor: "pointer", fontSize: 13, fontWeight: 600,
            color: COLORS.text, transition: "all 0.15s",
            fontFamily: "inherit",
          }}
            onMouseOver={e => { e.target.style.background = COLORS.bg; e.target.style.borderColor = COLORS.primaryLight; }}
            onMouseOut={e => { e.target.style.background = COLORS.surface; e.target.style.borderColor = COLORS.border; }}
          >
            {p.label}
          </button>
        ))}
        <button onClick={() => setSimProfile(profile)} style={{
          padding: "8px 16px", borderRadius: 99, border: `1.5px solid ${COLORS.primaryLight}`,
          background: COLORS.bg, cursor: "pointer", fontSize: 13, fontWeight: 600,
          color: COLORS.primary, fontFamily: "inherit",
        }}>
          ↺ Reset
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <MetricCard label="Simulated Total Tax" value={fmt(simCalc.totalTaxBurden)} sub={fmtPct(simCalc.effectiveRate) + " effective rate"} icon="📊" color={COLORS.primary} />
          <MetricCard label="Simulated Disposable" value={fmt(simCalc.disposableIncome)} icon="✅" color={COLORS.positive} />
        </div>
        <Card style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 8 }}>Tax Burden Change</div>
            <div style={{ fontSize: 44, fontWeight: 900, color: diff < 0 ? COLORS.positive : diff > 0 ? COLORS.danger : COLORS.textMuted, letterSpacing: "-0.03em" }}>
              {diff > 0 ? "+" : ""}{fmt(diff)}
            </div>
            <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 4 }}>
              Disposable income: {disposDiff > 0 ? "+" : ""}{fmt(disposDiff)}
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Base vs Simulated</div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={compData}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
            <Tooltip formatter={v => fmt(v)} />
            <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Direct" fill={COLORS.primary} stackId="a" radius={[0, 0, 0, 0]} />
            <Bar dataKey="Consumption" fill={COLORS.accent} stackId="a" />
            <Bar dataKey="Ownership" fill="#7C3AED" stackId="a" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

// ============================================================
// ASSUMPTIONS PAGE
// ============================================================
function AssumptionsPage() {
  const sections = [
    {
      title: "Income & Payroll Taxes",
      confidence: "High",
      items: [
        "Federal income tax uses 2024 brackets and the Basic Personal Amount ($15,705).",
        "Ontario provincial tax uses 2024 brackets, the Ontario Basic Personal Amount ($11,141), and surtax thresholds.",
        "Alberta and BC brackets are modeled for 2024.",
        "CPP Tier 1 rate: 5.95% on earnings $3,500–$68,500. CPP Tier 2: 4% on $68,500–$73,200.",
        "EI premium: 1.66% on insurable earnings up to $63,200.",
        "Self-employed individuals pay both employer and employee CPP shares (doubled), and typically opt out of EI.",
      ],
    },
    {
      title: "Sales & Consumption Taxes",
      confidence: "High",
      items: [
        "Ontario: HST 13% applied to most goods and services.",
        "Alberta: GST 5% only — no provincial sales tax.",
        "BC: GST 5% + PST 7% = 12% combined.",
        "Basic groceries are zero-rated under Canadian GST/HST legislation — no tax applied.",
        "Restaurant meals, shopping, phone/internet, subscriptions, and most services are fully taxable.",
        "Alcohol and cannabis are taxable at standard rates plus additional excise estimates.",
      ],
    },
    {
      title: "Fuel & Carbon Tax",
      confidence: "Medium",
      items: [
        "Ontario fuel tax estimate: ~$0.147/L provincial + $0.10/L federal + $0.1761/L federal carbon tax.",
        "Carbon tax rate for 2024 is approximately $0.1761/L based on $65/tonne CO₂ equivalent.",
        "Fuel tax is estimated from litres entered — actual pump price varies by retailer and region.",
        "Provincial fuel tax rates vary — Ontario, Alberta, and BC rates are included.",
      ],
    },
    {
      title: "Excise Taxes (Alcohol, Tobacco, Cannabis)",
      confidence: "Estimated",
      items: [
        "Excise taxes are embedded in retail prices and not separately itemized at checkout.",
        "Alcohol excise is estimated at ~30% of retail spend, based on average federal/provincial duty rates.",
        "Tobacco/vaping excise is estimated at ~55% of retail spend — Canadian tobacco taxes are among the highest globally.",
        "Cannabis excise is estimated at ~25% based on federal framework.",
        "These are approximations — exact excise burden varies by product type and province.",
      ],
    },
    {
      title: "Property Tax",
      confidence: "Medium",
      items: [
        "Property tax is estimated using city-level average mill rates applied to your entered home value.",
        "Toronto: ~0.611%, Ottawa: ~1.039%, Hamilton: ~1.185%, Calgary: ~0.720%, Vancouver: ~0.278%.",
        "Actual property tax depends on MPAC or municipal assessed value, which may differ from market value.",
        "This is a financial awareness estimate — consult your municipal tax notice for actual amounts.",
        "Renters are not subject to property tax directly (though it may be embedded in rent).",
      ],
    },
    {
      title: "Luxury Tax",
      confidence: "High",
      items: [
        "Canada's federal Select Luxury Items Tax Act applies to new passenger vehicles over $100,000.",
        "Tax is the lesser of: 10% of amount above threshold, or 20% of full vehicle price.",
        "Aircraft and boats over $250,000 are also subject to similar luxury tax treatment.",
        "This module calculates based on your entered vehicle purchase amount.",
      ],
    },
    {
      title: "General Methodology",
      confidence: "N/A",
      items: [
        "TaxMirror Canada is an educational estimation tool, not tax filing software.",
        "Results do not account for tax credits, deductions (RRSP, TFSA), childcare, disability, or other personal credits.",
        "Effective tax rate shown = total estimated tax burden / gross income.",
        "Disposable income = gross income − total tax burden − rent/mortgage − groceries.",
        "Tax rules should be reviewed and updated annually by the maintainer.",
        "This app does not store any personal data.",
      ],
    },
  ];

  return (
    <div>
      <SectionTitle sub="How TaxMirror Canada calculates your tax burden">Assumptions & Methodology</SectionTitle>

      <div style={{ background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 12, padding: "14px 18px", marginBottom: 24, fontSize: 13, color: "#92400E" }}>
        <strong>⚖️ Important:</strong> TaxMirror Canada provides estimated tax insights for educational and financial awareness purposes only. It does not provide legal, accounting, or tax filing advice. Always consult a qualified tax professional for your specific situation.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {sections.map((s, i) => (
          <Card key={i}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: COLORS.text }}>{s.title}</div>
              {s.confidence !== "N/A" && <Badge type={s.confidence} />}
            </div>
            <ul style={{ margin: 0, padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 6 }}>
              {s.items.map((item, j) => (
                <li key={j} style={{ fontSize: 13, color: COLORS.textMuted, lineHeight: 1.6 }}>{item}</li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================
const TABS = [
  { id: "overview", label: "Overview", icon: "📊" },
  { id: "layers", label: "Tax Layers", icon: "🏛️" },
  { id: "spending", label: "Spending Analyzer", icon: "🛒" },
  { id: "compare", label: "Province Compare", icon: "🗺️" },
  { id: "whatif", label: "What-If", icon: "🔮" },
  { id: "assumptions", label: "Methodology", icon: "📋" },
];

export default function App() {
  const [tab, setTab] = useState("overview");
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const calc = useMemo(() => runFullCalculation(profile), [profile]);

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, fontFamily: "'DM Sans', 'Segoe UI', sans-serif", color: COLORS.text }}>
      {/* TOP HEADER */}
      <div style={{
        background: `linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.primaryLight} 100%)`,
        padding: "0 28px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        height: 60,
        boxShadow: "0 2px 20px rgba(30,95,173,0.25)",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🪞</div>
          <div>
            <div style={{ fontWeight: 900, fontSize: 17, color: "white", letterSpacing: "-0.02em" }}>
              TaxMirror Canada <span style={{ fontWeight: 400, fontSize: 13, opacity: 0.75 }}>by Plainlyworks</span>
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginTop: 0 }}>2024 Tax Year · Educational Estimates Only</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "5px 14px", color: "white", fontSize: 13, fontWeight: 600 }}>
            {PROVINCES.find(p => p.code === profile.province)?.name} · {fmt(profile.salary)}
          </div>
          <button
            onClick={() => setSidebarOpen(o => !o)}
            style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "white", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}
          >
            {sidebarOpen ? "Hide Form" : "Edit Profile"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", maxWidth: 1400, margin: "0 auto" }}>
        {/* SIDEBAR FORM */}
        {sidebarOpen && (
          <div style={{
            width: 340, minWidth: 340, background: COLORS.surface,
            borderRight: `1px solid ${COLORS.border}`,
            height: "calc(100vh - 60px)", overflowY: "auto",
            padding: "24px 20px",
            position: "sticky", top: 60,
          }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: COLORS.primary, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>Enter Your Profile</div>

            {/* Reset Buttons */}
            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              <button
                onClick={() => setProfile(DEFAULT_PROFILE)}
                style={{
                  flex: 1, padding: "8px 10px", borderRadius: 10,
                  border: `1.5px solid ${COLORS.primaryLight}`,
                  background: COLORS.bg, cursor: "pointer",
                  fontSize: 12, fontWeight: 700, color: COLORS.primary,
                  fontFamily: "inherit", transition: "all 0.15s",
                }}
                onMouseOver={e => e.currentTarget.style.background = COLORS.border}
                onMouseOut={e => e.currentTarget.style.background = COLORS.bg}
              >
                ↺ Reset to Demo
              </button>
              <button
                onClick={() => setProfile({
                  salary: 0, province: "ON", city: "Toronto",
                  employmentType: "employee", householdType: "single",
                  isHomeowner: false, homeValue: 0, vehicleAmount: 0, luxuryAmount: 0,
                  spending: {
                    groceries: 0, restaurants: 0, gas: 0, litresPerMonth: 0,
                    shopping: 0, phoneInternet: 0, subscriptions: 0,
                    alcohol: 0, tobaccoCannabis: 0, rent: 0, mortgage: 0, otherPurchases: 0,
                  },
                })}
                style={{
                  flex: 1, padding: "8px 10px", borderRadius: 10,
                  border: `1.5px solid ${COLORS.border}`,
                  background: COLORS.surface, cursor: "pointer",
                  fontSize: 12, fontWeight: 700, color: COLORS.textMuted,
                  fontFamily: "inherit", transition: "all 0.15s",
                }}
                onMouseOver={e => e.currentTarget.style.background = COLORS.bg}
                onMouseOut={e => e.currentTarget.style.background = COLORS.surface}
              >
                🗑️ Start Fresh
              </button>
            </div>

            <ProfileForm profile={profile} setProfile={setProfile} />
          </div>
        )}

        {/* MAIN CONTENT */}
        <div style={{ flex: 1, padding: "24px 28px", overflowX: "hidden" }}>
          {/* TABS */}
          <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: `2px solid ${COLORS.border}`, paddingBottom: 0 }}>
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: "10px 16px", border: "none", cursor: "pointer",
                  background: "transparent", fontFamily: "inherit",
                  fontSize: 13, fontWeight: tab === t.id ? 700 : 500,
                  color: tab === t.id ? COLORS.primary : COLORS.textMuted,
                  borderBottom: tab === t.id ? `2px solid ${COLORS.primary}` : "2px solid transparent",
                  marginBottom: -2,
                  transition: "all 0.15s",
                }}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {/* PAGE CONTENT */}
          {tab === "overview" && <OverviewPage calc={calc} profile={profile} />}
          {tab === "layers" && <TaxLayersPage calc={calc} />}
          {tab === "spending" && <SpendingAnalyzerPage calc={calc} profile={profile} />}
          {tab === "compare" && <ProvinceComparisonPage profile={profile} />}
          {tab === "whatif" && <WhatIfPage profile={profile} calc={calc} />}
          {tab === "assumptions" && <AssumptionsPage />}

          {/* FOOTER */}
          <div style={{ marginTop: 40, paddingTop: 20, borderTop: `1px solid ${COLORS.border}`, textAlign: "center", fontSize: 11, color: COLORS.textLight }}>
            TaxMirror Canada by Plainlyworks · Educational estimates only, not tax filing advice · 2024 Tax Year Data
          </div>
        </div>
      </div>
    </div>
  );
}
