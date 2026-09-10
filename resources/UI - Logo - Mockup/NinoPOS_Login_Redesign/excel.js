const XLSX = require('xlsx');

const headers = [
  'id', 'name', 'category_id', 'category_name', 'cost_price',
  'selling_price', 'unit', 'stock_quantity', 'is_weighted', 'status',
];

function readProducts(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('File Excel không có worksheet.');
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (!rows.length) throw new Error('File Excel không có dữ liệu.');
  const missing = headers.filter((header) => !Object.prototype.hasOwnProperty.call(rows[0], header));
  if (missing.length) throw new Error(`Thiếu cột bắt buộc: ${missing.join(', ')}`);
  return rows;
}

function writeProducts(filePath, rows) {
  const exportRows = rows.map((row) => Object.fromEntries(headers.map((header) => [header, row[header] ?? ''])));
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(exportRows, { header: headers });
  sheet['!cols'] = headers.map((header) => ({ wch: Math.max(14, header.length + 2) }));
  XLSX.utils.book_append_sheet(workbook, sheet, 'Hang hoa');
  XLSX.writeFile(workbook, filePath);
}

module.exports = { headers, readProducts, writeProducts };
