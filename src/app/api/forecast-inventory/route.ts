"use server";

import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import path from "path";
import {
  ForecastInventorySummaryData,
  ForecastInventoryData,
} from "@/types/sales";

// 기본 파일 목록 (존재 여부 체크 후 사용)
const FORECAST_MONTH_FILES = ["25.11", "25.12", "26.01", "26.02", "26.03"];

// 로컬 윈도우 경로 (사용자가 제공한 경로)
const WINDOWS_FORECAST_DIR = "C:\\3.accweekcover\\data\\inventory(forecast)";

// 리포지토리 기준 상대 경로 (없을 경우 대비용)
const RELATIVE_FORECAST_DIR = path.join(
  process.cwd(),
  "..",
  "data",
  "inventory(forecast)"
);

// 실제 사용 경로 결정 (존재하는 경로 우선)
function getForecastDir(): string | null {
  if (existsSync(WINDOWS_FORECAST_DIR)) {
    return WINDOWS_FORECAST_DIR;
  }
  if (existsSync(RELATIVE_FORECAST_DIR)) {
    return RELATIVE_FORECAST_DIR;
  }
  return null;
}

// 간단한 CSV 파서 (쉼표 구분, 따옴표/쉼표 포함 필드는 없다고 가정)
function parseCsv(content: string): Record<string, string>[] {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  // BOM 제거
  const headerLine = lines[0].replace(/^\uFEFF/, "");
  const headers = headerLine.split(",").map((h) => h.trim());

  const records: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split(",");
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      record[h] = (cols[idx] ?? "").trim();
    });
    records.push(record);
  }

  return records;
}

// CSV 컬럼 이름 상수
const COL_BRAND = "产品品牌";
const COL_ITEM = "产品中分类";
const COL_AMOUNT = "预计库存入库";

// 월 문자열 변환: "25.11" -> "2025.11"
function toFullYearMonth(shortYm: string): string {
  const [yy, mm] = shortYm.split(".");
  const yearNum = parseInt(yy, 10);
  const fullYear =
    yearNum >= 0 && yearNum < 50 ? 2000 + yearNum : 1900 + yearNum;
  return `${fullYear}.${mm}`;
}

export async function GET() {
  try {
    const dir = getForecastDir();

    // 경로가 없으면 빈 데이터 반환 (Vercel 등 환경에서 안전하게 동작)
    if (!dir) {
      const empty: ForecastInventorySummaryData = {
        brands: {
          MLB: {},
          "MLB KIDS": {},
          DISCOVERY: {},
        },
        months: [],
      };
      return NextResponse.json(empty);
    }

    const brands: ForecastInventorySummaryData["brands"] = {
      MLB: {},
      "MLB KIDS": {},
      DISCOVERY: {},
    };
    const monthSet = new Set<string>();

    for (const shortYm of FORECAST_MONTH_FILES) {
      const filePath = path.join(dir, `${shortYm}.csv`);
      if (!existsSync(filePath)) {
        continue;
      }

      const fullYm = toFullYearMonth(shortYm); // 예: "2025.11"
      monthSet.add(fullYm);

      const raw = readFileSync(filePath, "utf-8");
      const rows = parseCsv(raw);

      // 브랜드별 집계
      for (const row of rows) {
        const brandName = row[COL_BRAND]?.trim();
        if (!brandName) continue;

        // 프로젝트에서 사용하는 브랜드 키와 동일하다고 가정
        if (
          brandName !== "MLB" &&
          brandName !== "MLB KIDS" &&
          brandName !== "DISCOVERY"
        ) {
          continue;
        }

        const item = row[COL_ITEM]?.trim();
        const amountRaw = row[COL_AMOUNT]?.replace(/,/g, "") ?? "0";
        const amount = parseFloat(amountRaw);
        if (!item || isNaN(amount)) continue;

        // 아이템 필터 (Shoes / Headwear / Bag / Acc_etc 만 사용)
        if (
          item !== "Shoes" &&
          item !== "Headwear" &&
          item !== "Bag" &&
          item !== "Acc_etc"
        ) {
          continue;
        }

        const brandData: ForecastInventoryData = brands[
          brandName as keyof typeof brands
        ];

        if (!brandData[fullYm]) {
          brandData[fullYm] = {};
        }

        const monthData = brandData[fullYm];
        monthData[item as keyof typeof monthData] =
          (monthData[item as keyof typeof monthData] || 0) + amount;
      }
    }

    const months = Array.from(monthSet).sort((a, b) => {
      const [ya, ma] = a.split(".").map(Number);
      const [yb, mb] = b.split(".").map(Number);
      if (ya !== yb) return ya - yb;
      return ma - mb;
    });

    const response: ForecastInventorySummaryData = {
      brands,
      months,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("입고예정 재고자산 API 오류:", error);
    return NextResponse.json(
      { error: "입고예정 재고자산 데이터를 불러오는데 실패했습니다." },
      { status: 500 }
    );
  }
}


