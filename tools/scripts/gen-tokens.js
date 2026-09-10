#!/usr/bin/env node
/**
 * =====================================================================
 *  NINOTEK — Design Tokens Generator
 * =====================================================================
 *  Đọc  : packages/design-tokens/tokens.json  (NGUỒN SỰ THẬT DUY NHẤT)
 *  Sinh : apps/nino-pos/.../Themes/NinotekColors.xaml   (WPF)
 *         packages/nino_ui_kit/lib/nino_tokens.dart     (Flutter)
 *         apps/nino-cloud/src/common/tokens.ts          (NestJS/web)
 *
 *  Chạy : node tools/scripts/gen-tokens.js
 *         node tools/scripts/gen-tokens.js --check   (CI: fail nếu lệch)
 *
 *  ⚠️ TUYỆT ĐỐI KHÔNG sửa tay các file được sinh ra — lần chạy sau sẽ ghi đè.
 *     Muốn đổi màu thì sửa tokens.json rồi chạy lại lệnh này.
 * =====================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const TOKENS_PATH = path.join(ROOT, 'packages', 'design-tokens', 'tokens.json');

const OUTPUTS = {
  xaml: path.join(ROOT, 'apps', 'nino-pos', 'src', 'Ninotek.POS.App', 'Themes', 'NinotekColors.xaml'),
  dart: path.join(ROOT, 'packages', 'nino_ui_kit', 'lib', 'nino_tokens.dart'),
  ts: path.join(ROOT, 'apps', 'nino-cloud', 'src', 'common', 'tokens.ts'),
};

const BANNER_LINES = [
  'FILE NÀY ĐƯỢC SINH TỰ ĐỘNG — KHÔNG SỬA TAY.',
  'Nguồn: packages/design-tokens/tokens.json',
  'Sinh lại: node tools/scripts/gen-tokens.js',
];

// --- Tiện ích -----------------------------------------------------------

/** '#007AFF' -> '#FF007AFF' (WPF dùng ARGB, alpha đứng trước). */
function toArgb(hex) {
  const h = hex.replace('#', '').toUpperCase();
  if (h.length === 6) return `#FF${h}`;
  if (h.length === 8) return `#${h.slice(6)}${h.slice(0, 6)}`; // RGBA -> ARGB
  throw new Error(`Mã màu không hợp lệ: ${hex}`);
}

/** '#007AFF' -> '0xFF007AFF' (Dart Color). */
function toDartColor(hex) {
  const h = hex.replace('#', '').toUpperCase();
  if (h.length === 6) return `0xFF${h}`;
  if (h.length === 8) return `0x${h.slice(6)}${h.slice(0, 6)}`;
  throw new Error(`Mã màu không hợp lệ: ${hex}`);
}

function pascal(s) {
  return s.replace(/(^|[^A-Za-z0-9])([a-z])/g, (_, __, c) => c.toUpperCase());
}

function camel(s) {
  const p = pascal(s);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

/** Duyệt cây token, trả về [{ path: ['color','brand','primary'], value: '#007AFF' }]. */
function flattenColors(node, trail = []) {
  const out = [];
  for (const [key, val] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    if (val && typeof val === 'object') {
      if (typeof val.value === 'string' && val.value.startsWith('#')) {
        out.push({ path: [...trail, key], value: val.value, label: val.label, comment: val.comment });
      } else if (!Array.isArray(val.value)) {
        out.push(...flattenColors(val, [...trail, key]));
      }
    }
  }
  return out;
}

// --- Bộ sinh ------------------------------------------------------------

function generateXaml(tokens) {
  const colors = flattenColors(tokens.color);
  const L = [];
  L.push('<!--');
  BANNER_LINES.forEach((b) => L.push(`    ${b}`));
  L.push('-->');
  L.push('<ResourceDictionary xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"');
  L.push('                    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"');
  L.push('                    xmlns:sys="clr-namespace:System;assembly=mscorlib">');
  L.push('');
  L.push('    <!-- ==================== MÀU SẮC ==================== -->');

  let group = '';
  for (const c of colors) {
    const g = c.path.slice(0, -1).join('.');
    if (g !== group) {
      group = g;
      L.push('');
      L.push(`    <!-- ${g} -->`);
    }
    const name = c.path.map(pascal).join('');
    const note = c.comment || c.label;
    L.push(`    <Color x:Key="${name}Color">${toArgb(c.value)}</Color>${note ? `  <!-- ${note} -->` : ''}`);
    L.push(`    <SolidColorBrush x:Key="${name}Brush" Color="{StaticResource ${name}Color}" />`);
  }

  L.push('');
  L.push('    <!-- ==================== KÍCH THƯỚC CHẠM ==================== -->');
  L.push('    <!-- Ràng buộc BẮT BUỘC theo Master SRS: mọi nút bấm >= 48x48 dp -->');
  for (const [k, v] of Object.entries(tokens.touchTarget)) {
    if (k.startsWith('$') || typeof v.value !== 'number') continue;
    L.push(`    <sys:Double x:Key="TouchTarget${pascal(k)}">${v.value}</sys:Double>`);
  }

  L.push('');
  L.push('    <!-- ==================== KHOẢNG CÁCH ==================== -->');
  for (const [k, v] of Object.entries(tokens.spacing)) {
    if (k.startsWith('$')) continue;
    L.push(`    <sys:Double x:Key="Spacing${k.toUpperCase()}">${v.value}</sys:Double>`);
  }

  L.push('');
  L.push('    <!-- ==================== BO GÓC ==================== -->');
  for (const [k, v] of Object.entries(tokens.radius)) {
    if (k.startsWith('$')) continue;
    L.push(`    <CornerRadius x:Key="Radius${pascal(k)}">${v.value}</CornerRadius>`);
  }

  L.push('');
  L.push('    <!-- ==================== CHỮ ==================== -->');
  const ff = tokens.typography.fontFamily;
  for (const [k, v] of Object.entries(ff)) {
    if (k.startsWith('$')) continue;
    const stack = [v.value, ...(v.fallback || [])].join(', ');
    L.push(`    <FontFamily x:Key="Font${pascal(k)}">${stack}</FontFamily>`);
  }
  for (const [k, v] of Object.entries(tokens.typography.scale)) {
    if (k.startsWith('$')) continue;
    L.push(`    <sys:Double x:Key="FontSize${pascal(k)}">${v.size}</sys:Double>`);
  }

  L.push('');
  L.push('</ResourceDictionary>');
  return L.join('\n') + '\n';
}

function generateDart(tokens) {
  const colors = flattenColors(tokens.color);
  const L = [];
  BANNER_LINES.forEach((b) => L.push(`// ${b}`));
  L.push('');
  L.push('// ignore_for_file: constant_identifier_names');
  L.push('');
  L.push("import 'package:flutter/widgets.dart';");
  L.push('');
  L.push('/// Design tokens của Ninotek, dùng chung cho NinoOrder và NinoDash.');
  L.push('abstract final class NinoTokens {');

  let group = '';
  for (const c of colors) {
    const g = c.path.slice(0, -1).join('.');
    if (g !== group) {
      group = g;
      L.push('');
      L.push(`  // --- ${g} ---`);
    }
    const name = camel(c.path.map(pascal).join(''));
    const note = c.comment || c.label;
    if (note) L.push(`  /// ${note}`);
    L.push(`  static const Color ${name} = Color(${toDartColor(c.value)});`);
  }

  L.push('');
  L.push('  // --- Kích thước chạm (Master SRS: tối thiểu 48x48 dp) ---');
  for (const [k, v] of Object.entries(tokens.touchTarget)) {
    if (k.startsWith('$') || typeof v.value !== 'number') continue;
    L.push(`  static const double touchTarget${pascal(k)} = ${v.value.toFixed(1)};`);
  }

  L.push('');
  L.push('  // --- Khoảng cách ---');
  for (const [k, v] of Object.entries(tokens.spacing)) {
    if (k.startsWith('$')) continue;
    L.push(`  static const double space${k.toUpperCase()} = ${v.value.toFixed(1)};`);
  }

  L.push('');
  L.push('  // --- Bo góc ---');
  for (const [k, v] of Object.entries(tokens.radius)) {
    if (k.startsWith('$')) continue;
    L.push(`  static const double radius${pascal(k)} = ${v.value.toFixed(1)};`);
  }

  L.push('');
  L.push('  // --- Cỡ chữ ---');
  for (const [k, v] of Object.entries(tokens.typography.scale)) {
    if (k.startsWith('$')) continue;
    L.push(`  static const double fontSize${pascal(k)} = ${v.size.toFixed(1)};`);
  }

  L.push('');
  L.push('  // --- Hằng số kết nối (Offline-First) ---');
  for (const [k, v] of Object.entries(tokens.connectivity)) {
    if (k.startsWith('$')) continue;
    L.push(`  static const int ${camel(k)} = ${v.value};`);
  }

  L.push('');
  L.push('  /// Màu tương ứng với trạng thái bàn trong sơ đồ bàn.');
  L.push('  static const Map<String, Color> tableStatusColors = <String, Color>{');
  for (const [k, v] of Object.entries(tokens.color.tableStatus)) {
    if (k.startsWith('$')) continue;
    L.push(`    '${k}': Color(${toDartColor(v.value)}), // ${v.label}`);
  }
  L.push('  };');

  L.push('');
  L.push('  /// Màu tương ứng với trạng thái chế biến món (KDS).');
  L.push('  static const Map<String, Color> kitchenStatusColors = <String, Color>{');
  for (const [k, v] of Object.entries(tokens.color.kitchenStatus)) {
    if (k.startsWith('$')) continue;
    L.push(`    '${k}': Color(${toDartColor(v.value)}), // ${v.label}`);
  }
  L.push('  };');

  L.push('}');
  return L.join('\n') + '\n';
}

function generateTs(tokens) {
  const colors = flattenColors(tokens.color);
  const L = [];
  BANNER_LINES.forEach((b) => L.push(`// ${b}`));
  L.push('');
  L.push('export const NinoTokens = {');
  L.push('  color: {');
  for (const c of colors) {
    L.push(`    ${camel(c.path.map(pascal).join(''))}: '${c.value}',`);
  }
  L.push('  },');
  L.push('  touchTarget: {');
  for (const [k, v] of Object.entries(tokens.touchTarget)) {
    if (k.startsWith('$') || typeof v.value !== 'number') continue;
    L.push(`    ${camel(k)}: ${v.value},`);
  }
  L.push('  },');
  L.push('  connectivity: {');
  for (const [k, v] of Object.entries(tokens.connectivity)) {
    if (k.startsWith('$')) continue;
    L.push(`    ${camel(k)}: ${v.value},`);
  }
  L.push('  },');
  L.push('} as const;');
  return L.join('\n') + '\n';
}

// --- Main ---------------------------------------------------------------

function main() {
  const checkOnly = process.argv.includes('--check');
  const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));

  const generated = {
    xaml: generateXaml(tokens),
    dart: generateDart(tokens),
    ts: generateTs(tokens),
  };

  let drifted = 0;
  for (const [kind, content] of Object.entries(generated)) {
    const target = OUTPUTS[kind];
    const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;

    if (checkOnly) {
      if (existing !== content) {
        console.error(`LỆCH: ${path.relative(ROOT, target)} không khớp tokens.json`);
        drifted++;
      }
      continue;
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
    const lines = content.split('\n').length;
    console.log(`  ${path.relative(ROOT, target)}  (${lines} dòng)`);
  }

  if (checkOnly) {
    if (drifted > 0) {
      console.error(
        `\n${drifted} file lệch so với tokens.json. Chạy: node tools/scripts/gen-tokens.js`,
      );
      process.exit(1);
    }
    console.log('Tất cả file design token khớp với tokens.json.');
    return;
  }

  const n = flattenColors(tokens.color).length;
  console.log(`\nĐã sinh xong từ ${n} token màu.`);
}

main();
