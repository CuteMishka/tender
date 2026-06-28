type XlsxCell = string | number | null | undefined;

export type XlsxColumn<T extends Record<string, XlsxCell>> = {
  key: keyof T;
  header: string;
  width?: number;
  type?: "text" | "money" | "date";
};

export type XlsxFilter = {
  label: string;
  value: string;
};

export type XlsxExportOptions<T extends Record<string, XlsxCell>> = {
  fileName: string;
  sheetName: string;
  title: string;
  subtitle?: string;
  filters?: XlsxFilter[];
  columns: XlsxColumn<T>[];
  rows: T[];
};

export async function exportStyledXlsx<T extends Record<string, XlsxCell>>(options: XlsxExportOptions<T>): Promise<void> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Tender";
  workbook.lastModifiedBy = "Tender";
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet(safeSheetName(options.sheetName), {
    views: [{ state: "frozen", ySplit: headerRow(options), topLeftCell: `A${firstDataRow(options)}` }],
    properties: { defaultRowHeight: 18 },
  });

  buildSheet(worksheet, options);
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }), ensureXlsxName(options.fileName));
}

function buildSheet<T extends Record<string, XlsxCell>>(worksheet: ExcelWorksheet, options: XlsxExportOptions<T>): void {
  const columnCount = options.columns.length;
  const lastColumn = columnName(columnCount);
  const filters = options.filters || [];
  const filterStart = 4;
  const header = headerRow(options);
  const firstData = firstDataRow(options);
  const lastData = Math.max(firstData, firstData + options.rows.length - 1);

  worksheet.columns = options.columns.map((column) => ({
    key: String(column.key),
    width: column.width || 18,
  }));

  worksheet.mergeCells(`A1:${lastColumn}1`);
  worksheet.getCell("A1").value = options.title;
  styleTitle(worksheet.getCell("A1"));
  worksheet.getRow(1).height = 28;

  if (options.subtitle) {
    worksheet.mergeCells(`A2:${lastColumn}2`);
    worksheet.getCell("A2").value = options.subtitle;
    styleSubtitle(worksheet.getCell("A2"));
  }

  if (filters.length) {
    filters.forEach((filter, index) => {
      const rowNumber = filterStart + index;
      worksheet.getCell(rowNumber, 1).value = filter.label;
      worksheet.getCell(rowNumber, 2).value = filter.value;
      styleFilterLabel(worksheet.getCell(rowNumber, 1));
      styleFilterValue(worksheet.getCell(rowNumber, 2));
    });
  } else {
    worksheet.getCell(filterStart, 1).value = "Фильтры";
    worksheet.getCell(filterStart, 2).value = "Не применялись";
    styleFilterLabel(worksheet.getCell(filterStart, 1));
    styleFilterValue(worksheet.getCell(filterStart, 2));
  }

  const headerRowRef = worksheet.getRow(header);
  options.columns.forEach((column, index) => {
    const cell = headerRowRef.getCell(index + 1);
    cell.value = column.header;
    styleHeader(cell);
  });
  headerRowRef.height = 22;

  options.rows.forEach((row, rowIndex) => {
    const sheetRow = worksheet.getRow(firstData + rowIndex);
    options.columns.forEach((column, columnIndex) => {
      const cell = sheetRow.getCell(columnIndex + 1);
      const value = row[column.key];
      cell.value = typeof value === "number" ? value : value == null ? "" : String(value);
      styleBody(cell, rowIndex % 2 === 1, column.type);
    });
  });

  worksheet.autoFilter = {
    from: { row: header, column: 1 },
    to: { row: lastData, column: columnCount },
  };
  worksheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
  };
}

function headerRow(options: XlsxExportOptions<Record<string, XlsxCell>>): number {
  const filterRows = options.filters?.length ? options.filters.length : 1;
  return 4 + filterRows + 2;
}

function firstDataRow(options: XlsxExportOptions<Record<string, XlsxCell>>): number {
  return headerRow(options) + 1;
}

function styleTitle(cell: ExcelCell): void {
  cell.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  cell.fill = solidFill("FF059669");
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
}

function styleSubtitle(cell: ExcelCell): void {
  cell.font = { size: 11, color: { argb: "FF475569" } };
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
}

function styleFilterLabel(cell: ExcelCell): void {
  cell.font = { bold: true, color: { argb: "FF166534" } };
  cell.fill = solidFill("FFEFFDF5");
  cell.border = thinBorder();
}

function styleFilterValue(cell: ExcelCell): void {
  cell.fill = solidFill("FFEFFDF5");
  cell.border = thinBorder();
}

function styleHeader(cell: ExcelCell): void {
  cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
  cell.fill = solidFill("FF059669");
  cell.border = thinBorder();
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
}

function styleBody(cell: ExcelCell, shaded: boolean, type?: "text" | "money" | "date"): void {
  cell.border = thinBorder();
  cell.alignment = { vertical: "top", wrapText: true };
  if (shaded) cell.fill = solidFill("FFF8FAFC");
  if (type === "money") {
    cell.numFmt = "#,##0";
    cell.alignment = { horizontal: "right", vertical: "top" };
  }
}

function solidFill(argb: string): ExcelFill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function thinBorder(): ExcelBorder {
  const side = { style: "thin" as const, color: { argb: "FFD1D5DB" } };
  return { top: side, left: side, bottom: side, right: side };
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function columnName(index: number): string {
  let name = "";
  let n = index;
  while (n > 0) {
    const mod = (n - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    n = Math.floor((n - mod) / 26);
  }
  return name;
}

function safeSheetName(value: string): string {
  return (value || "Export").replace(/[\\/?*\[\]:]/g, " ").slice(0, 31).trim() || "Export";
}

function ensureXlsxName(value: string): string {
  const safe = value.trim().replace(/[\\/:*?"<>|]+/g, "_") || "export";
  return safe.toLowerCase().endsWith(".xlsx") ? safe : `${safe}.xlsx`;
}

type ExcelWorksheet = import("exceljs").Worksheet;
type ExcelCell = import("exceljs").Cell;
type ExcelFill = import("exceljs").Fill;
type ExcelBorder = import("exceljs").Borders;
