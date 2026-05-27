export type NumericLike = number | string | null | undefined;

export interface IncomeRow {
  periodo?: string;
  revenue: NumericLike;
  ebit: NumericLike;
  sga: NumericLike;
  tax_rate?: NumericLike;
  impuestos?: NumericLike;
  ebt?: NumericLike;
  capex?: NumericLike;
}

export interface CashFlowRow {
  periodo?: string;
  capex?: NumericLike;
}

export interface BalanceRow {
  periodo?: string;
  ppe: NumericLike;
  cuentas_por_cobrar: NumericLike;
  inventario: NumericLike;
  cuentas_por_pagar: NumericLike;
  inventario_promedio_historico?: NumericLike;
  inventario_promedio_anos_1_a_6?: NumericLike;
}

export interface Lever {
  nombre: string;
  palanca: 'A - Margen' | 'B - Capital';
  color: string;
  impacto: number;
  delta_pp: number;
  descripcion: string;
  unidad: 'NOPAT' | 'capital liberado';
  frecuencia?: 'anual';
  tiempo_captura_meses: number;
  facilidad_captura: number;
}

export interface ValueBridge {
  roic_actual: number;
  roic_potencial: number;
  delta_pp: number;
  levers: Lever[];
  total_valor: number;
  nopat_margin: number;
  capital_turnover: number;
}

function toNumber(value: NumericLike): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const clean = value.replace(/,/g, '').trim();
    const parsed = Number(clean);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function safeDivide(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
  return numerator / denominator;
}

function inferTaxRate(row: IncomeRow): number {
  const explicit = toNumber(row.tax_rate);
  if (explicit > 0 && explicit < 1) return explicit;

  const impuestos = Math.abs(toNumber(row.impuestos));
  const ebt = Math.abs(toNumber(row.ebt));
  const ratio = safeDivide(impuestos, ebt);

  if (ratio > 0 && ratio < 1) return ratio;
  return 0.3;
}

function getNopat(row: IncomeRow): number {
  const ebit = toNumber(row.ebit);
  const taxRate = inferTaxRate(row);
  return ebit * (1 - taxRate);
}

function getInvestedCapital(balance: BalanceRow): number {
  const ppe = toNumber(balance.ppe);
  const cxc = toNumber(balance.cuentas_por_cobrar);
  const inventario = toNumber(balance.inventario);
  const cxp = toNumber(balance.cuentas_por_pagar);
  const wcNeto = cxc + inventario - cxp;
  return ppe + wcNeto;
}

export function calcROIC(income: IncomeRow, balance: BalanceRow): number {
  const nopat = getNopat(income);
  const investedCapital = getInvestedCapital(balance);
  return safeDivide(nopat, investedCapital);
}

export function calcLevers(rows: IncomeRow[], balance: BalanceRow, cashflow?: CashFlowRow[]): Lever[] {
  if (rows.length === 0) return [];


  const actual = rows[rows.length - 1];
  const historical = rows.length >= 7 ? rows.slice(0, 6) : rows.slice(0, -1);

  const revActual = toNumber(actual.revenue);
  const sgaActual = Math.abs(toNumber(actual.sga));
  const ratioActual = safeDivide(sgaActual, revActual);

  const histRatios = historical
    .map((row) => {
      const rev = toNumber(row.revenue);
      const sga = Math.abs(toNumber(row.sga));
      return safeDivide(sga, rev);
    })
    .filter((ratio) => ratio > 0);
  const ratioHistMin = histRatios.length > 0 ? Math.min(...histRatios) : ratioActual;

  const leverSga = Math.max(0, (ratioActual - ratioHistMin) * revActual);

  const capexSeries = Array.isArray(cashflow)
    ? cashflow
      .slice(-4)
      .map((row) => Math.abs(toNumber(row.capex)))
      .filter((value) => value > 0)
    : [];
  const capexPromedio4 = capexSeries.length > 0
    ? capexSeries.reduce((sum, value) => sum + value, 0) / capexSeries.length
    : 0;
  const leverCapex = Math.max(0, capexPromedio4 * 0.25);

  const inventarioActual = toNumber(balance.inventario);
  const inventarioHistoricoPromedio = toNumber(
    balance.inventario_promedio_anos_1_a_6 ?? balance.inventario_promedio_historico
  );
  const leverInventario = Math.max(0, inventarioActual - inventarioHistoricoPromedio);

  const taxRate = inferTaxRate(actual);
  const capitalInvertidoActual = getInvestedCapital(balance);
  const calcDeltaPp = (impacto: number) =>
    Number(((impacto * (1 - taxRate)) / Math.max(1, capitalInvertidoActual) * 100).toFixed(1));

  return [
    {
      nombre: 'Reduce SG&A / Overhead',
      palanca: 'A - Margen',
      color: '#7F77DD',
      impacto: Math.round(leverSga),
      delta_pp: calcDeltaPp(leverSga),
      descripcion: 'SG&A crecio 25% en 8 anos mientras revenue crecio 15%',
      unidad: 'NOPAT',
      tiempo_captura_meses: 18,
      facilidad_captura: 6
    },
    {
      nombre: 'ROIC-based capex criteria',
      palanca: 'B - Capital',
      color: '#85B7EB',
      impacto: Math.round(leverCapex),
      delta_pp: calcDeltaPp(leverCapex),
      descripcion: '$126B en capex en 4 anos sin ROIC minimo requerido',
      unidad: 'capital liberado',
      frecuencia: 'anual',
      tiempo_captura_meses: 12,
      facilidad_captura: 8
    },
    {
      nombre: 'Normalize inventory',
      palanca: 'B - Capital',
      color: '#9FE1CB',
      impacto: Math.round(leverInventario),
      delta_pp: calcDeltaPp(leverInventario),
      descripcion: 'Inventario salto $20B en Year 7 sin crecimiento de revenue',
      unidad: 'capital liberado',
      tiempo_captura_meses: 6,
      facilidad_captura: 9
    }
  ];
}

export function buildValueBridge(actual: IncomeRow, balance: BalanceRow, levers: Lever[]): ValueBridge {
  const roicActualPct = calcROIC(actual, balance) * 100;

  const totalValor = levers.reduce((sum, lever) => sum + lever.impacto, 0);
  const totalDeltaPp = levers.reduce((sum, lever) => sum + lever.delta_pp, 0);
  const roicPotencialPct = roicActualPct + totalDeltaPp;

  // DuPont decomposition: ROIC = NOPAT margin × Capital turnover
  const revenue = toNumber(actual.revenue);
  const nopat = getNopat(actual);
  const capital = getInvestedCapital(balance);
  const nopatMargin = safeDivide(nopat, revenue) * 100;
  const capitalTurnover = safeDivide(revenue, capital);

  return {
    roic_actual: Number(roicActualPct.toFixed(1)),
    roic_potencial: Number(roicPotencialPct.toFixed(1)),
    delta_pp: Number(totalDeltaPp.toFixed(1)),
    levers,
    total_valor: Math.round(totalValor),
    nopat_margin: Number(nopatMargin.toFixed(1)),
    capital_turnover: Number(capitalTurnover.toFixed(2))
  };
}
