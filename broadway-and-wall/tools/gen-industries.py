#!/usr/bin/env python3
# Generate broadway-and-wall/src/engine/industryData.ts from the BEA 2023 summary Use table
# (Before Redefinitions, producers' prices) plus the hand facts below (ONE_ECONOMY_PLAN step 2b).
# The hand facts' sources are written out in src/engine/industries.ts: employment (CES 2023, QCEW
# for farms and forestry), space per worker (CBRE/BOMA, EIA MECS and CBECS), the off-floor and
# remote shares, the national trends (CES 1990-2019) and cycle betas (CES 2007-09), where each
# industry's firms are (INDUSTRIES_71.md 4b), and the trade whose financing each borrows.
import openpyxl, json, sys

# usage: python3 tools/gen-industries.py IOUse_Before_Redefinitions_PRO_1997-2023_Summary.xlsx src/engine/industryData.ts
# (the workbook is in apps.bea.gov/industry/iTables Static Files/AllTablesIO.zip)
XLSX = sys.argv[1]
OUT = sys.argv[2]

# id: (BEA codes (column/row), share of the code's column/row, label, type, group, space, sfPerWorker, empK,
#      offFloor, remote, natTrend, cycleBeta, where, financeLike)
# where: "local" (firms on the map and off it), "regional" (the region's background facilities: off the
# island, off the leasable floors), "outside" (no firms in the metro: always bought from out of town).
F = [
 ("farms",       ["111CA"], "Farms", "Farms, mines and energy", "making", "special", 0, 1200, 1, 0.01, 0.000, 0.3, "regional", "food"),
 ("forestry",    ["113FF"], "Forestry, fishing and related", "Farms, mines and energy", "making", "special", 0, 460, 1, 0.01, -0.018, 4.0, "regional", "logistics"),
 ("oilgas",      ["211"], "Oil and gas extraction", "Farms, mines and energy", "making", "special", 0, 120, 1, 0.02, -0.006, 0.0, "outside", "logistics"),
 ("mining",      ["212"], "Mining and quarrying", "Farms, mines and energy", "making", "special", 0, 190, 1, 0.02, -0.010, 1.6, "regional", "logistics"),
 ("miningsup",   ["213"], "Support for mining", "Farms, mines and energy", "making", "special", 0, 280, 1, 0.02, 0.026, 4.8, "outside", "logistics"),
 ("utilities",   ["22"], "Utilities", "Utilities and waste", "moving", "office", 230, 560, 0.8, 0.04, -0.010, 0.0, "local", "logistics"),
 ("construction",["23"], "Construction trades", "Construction", "other", "special", 400, 7950, 1, 0.04, 0.012, 4.3, "local", "logistics"),
 ("wood",        ["321"], "Wood products", "Factories: materials", "making", "industrial-mfg", 1100, 410, 0, 0.02, -0.010, 4.8, "local", "logistics"),
 ("minerals",    ["327"], "Concrete, glass and stone", "Factories: materials", "making", "industrial-mfg", 1400, 420, 0, 0.02, -0.009, 4.0, "local", "logistics"),
 ("primetals",   ["331"], "Primary metals (steel works)", "Farms, mines and energy", "making", "special", 0, 380, 1, 0.02, -0.020, 4.4, "regional", "logistics"),
 ("fabmetal",    ["332"], "Fabricated metal products", "Factories: metal and machinery", "making", "industrial-mfg", 1000, 1460, 0, 0.02, -0.004, 3.4, "local", "logistics"),
 ("machinery",   ["333"], "Machinery", "Factories: metal and machinery", "making", "industrial-mfg", 900, 1140, 0, 0.03, -0.009, 2.9, "local", "logistics"),
 ("electronics", ["334"], "Computers and electronics", "Factories: electronics", "making", "industrial-mfg", 600, 1090, 0, 0.04, -0.020, 1.9, "local", "tech"),
 ("electrical",  ["335"], "Electrical equipment and appliances", "Factories: electronics", "making", "industrial-mfg", 700, 430, 0, 0.03, -0.016, 2.7, "local", "logistics"),
 ("vehicles",    ["3361MV"], "Motor vehicles and parts", "Factories: metal and machinery", "making", "industrial-mfg", 900, 1060, 0, 0.02, -0.002, 6.3, "local", "logistics"),
 ("aerospace",   ["3364OT"], "Aircraft, ships and other transport equipment", "Factories: metal and machinery", "making", "industrial-mfg", 900, 720, 0, 0.04, -0.015, 0.5, "local", "logistics"),
 ("furniture",   ["337"], "Furniture", "Factories: consumer goods", "making", "industrial-mfg", 1000, 350, 0, 0.02, -0.016, 4.8, "local", "logistics"),
 ("miscmfg",     ["339"], "Medical devices, toys and other goods", "Factories: consumer goods", "making", "industrial-mfg", 700, 600, 0, 0.03, -0.005, 1.6, "local", "logistics"),
 ("food",        ["311FT"], "Food, drink and tobacco plants", "Factories: food and drink", "making", "industrial-mfg", 900, 1990, 0, 0.02, 0.0024, 0.3, "local", "food"),
 ("textiles",    ["313TT"], "Textile mills", "Factories: consumer goods", "making", "industrial-mfg", 700, 210, 0, 0.02, -0.037, 4.8, "local", "apparel"),
 ("apparel",     ["315AL"], "Apparel and leather", "Factories: consumer goods", "making", "industrial-mfg", 500, 110, 0, 0.02, -0.073, 4.3, "local", "apparel"),
 ("paper",       ["322"], "Paper and packaging", "Factories: materials", "making", "industrial-mfg", 1200, 330, 0, 0.02, -0.019, 1.9, "local", "logistics"),
 ("printing",    ["323"], "Printing", "Factories: consumer goods", "making", "industrial-mfg", 600, 400, 0, 0.03, -0.023, 3.2, "local", "logistics"),
 ("petroleum",   ["324"], "Refining (petroleum and coal products)", "Farms, mines and energy", "making", "special", 0, 110, 1, 0.02, -0.011, 0.6, "regional", "logistics"),
 ("chemicals",   ["325"], "Chemicals and pharmaceuticals", "Factories: materials", "making", "industrial-mfg", 1300, 900, 0, 0.04, -0.007, 1.0, "local", "logistics"),
 ("plastics",    ["326"], "Plastics and rubber", "Factories: materials", "making", "industrial-mfg", 1100, 740, 0, 0.02, -0.004, 3.5, "local", "logistics"),
 ("wholesale",   ["42"], "Wholesale and distribution", "Wholesale and warehouses", "moving", "industrial-warehouse", 1500, 6100, 0, 0.05, 0.004, 1.3, "local", "logistics"),
 ("autodealers", ["441"], "Car dealers and parts stores", "Shops", "selling", "retail", 1000, 2050, 0, 0.02, 0.0075, 3.2, "local", "apparel"),
 ("grocers",     ["445"], "Grocers and drink stores", "Groceries", "selling", "retail", 500, 3150, 0, 0.01, 0.0033, 0.2, "local", "food"),
 ("genmerch",    ["452"], "Department stores and supercentres", "Shops", "selling", "retail", 800, 3100, 0, 0.01, 0.0074, 0.5, "local", "apparel"),
 ("retail",      ["4A0"], "Other shops (clothing, home, online)", "Shops", "selling", "retail", 600, 7300, 0, 0.03, 0.006, 1.4, "local", "apparel"),
 ("air",         ["481"], "Airlines (the airport)", "Freight and transport", "moving", "special", 0, 530, 1, 0.02, -0.002, 1.3, "regional", "logistics"),
 ("rail",        ["482"], "Freight rail (the yard)", "Freight and transport", "moving", "special", 0, 150, 1, 0.02, -0.005, 2.1, "regional", "logistics"),
 ("water",       ["483"], "Shipping and the port", "Freight and transport", "moving", "special", 0, 65, 1, 0.02, 0.005, 1.0, "local", "logistics"),
 ("trucking",    ["484"], "Trucking", "Freight and transport", "moving", "industrial-warehouse", 1200, 1560, 0, 0.02, 0.0105, 2.1, "local", "logistics"),
 ("transit",     ["485"], "Transit, buses and taxis", "Freight and transport", "moving", "office", 230, 480, 0.9, 0.02, 0.021, 0.0, "local", "logistics"),
 ("pipelines",   ["486"], "Pipelines", "Farms, mines and energy", "moving", "special", 0, 50, 1, 0.02, -0.006, 0.0, "outside", "logistics"),
 ("transportsup",["487OS"], "Couriers, forwarding and transport support", "Freight and transport", "moving", "industrial-warehouse", 1000, 1865, 0, 0.03, 0.0095, 1.6, "local", "logistics"),
 ("warehousing", ["493"], "Warehousing and e-commerce fulfilment", "Wholesale and warehouses", "moving", "industrial-warehouse", 900, 1850, 0, 0.01, 0.036, 1.1, "local", "logistics"),
 ("publishing",  ["511"], "Publishing and software", "Tech and media", "office", "office", 175, 830, 0, 0.12, -0.005, 1.9, "local", "tech"),
 ("film",        ["512"], "Film and music", "Tech and media", "office", "office", 200, 450, 0, 0.10, 0.018, 0.8, "local", "tech"),
 ("telecom",     ["513"], "Broadcasting and telecoms", "Tech and media", "office", "office", 200, 900, 0, 0.08, -0.012, 1.4, "local", "tech"),
 ("data",        ["514"], "Data centres and internet services", "Tech and media", "office", "office", 175, 870, 0, 0.12, 0.033, 1.4, "local", "tech"),
 ("banks",       ["521CI"], "Banks and lenders", "Banks and investment", "office", "office", 200, 2620, 0, 0.09, 0.006, 1.3, "local", "finance"),
 ("securities",  ["523", "525"], "Securities, funds and trusts", "Banks and investment", "office", "office", 200, 1030, 0, 0.09, 0.025, 1.0, "local", "finance"),
 ("insurance",   ["524"], "Insurance", "Insurance", "office", "office", 190, 2950, 0, 0.10, 0.011, 1.1, "local", "insurance"),
 ("realestate",  ["ORE*0.14"], "Real estate brokers and managers", "Real estate", "office", "office", 230, 1172, 0, 0.10, 0.008, 1.4, "local", "finance"),
 ("rental",      ["532RL"], "Equipment rental and leasing", "Wholesale and warehouses", "office", "industrial-warehouse", 1200, 700, 0, 0.05, 0.005, 2.4, "local", "finance"),
 ("legal",       ["5411"], "Law firms", "Law and professional services", "office", "office", 250, 1190, 0, 0.11, 0.008, 0.5, "local", "law"),
 ("compdesign",  ["5415"], "IT services and computer design", "Tech and media", "office", "office", 175, 2500, 0, 0.13, 0.060, 0.5, "local", "tech"),
 ("professional",["5412OP"], "Accounting, consulting, design and R&D", "Law and professional services", "office", "office", 210, 6910, 0, 0.11, 0.031, 1.4, "local", "law"),
 ("hq",          ["55"], "Company headquarters", "Headquarters and back offices", "office", "office", 225, 2450, 0, 0.08, 0.013, 0.5, "local", "insurance"),
 ("admin",       ["561"], "Staffing, security and cleaning", "Headquarters and back offices", "office", "office", 200, 9000, 0, 0.06, 0.032, 2.1, "local", "law"),
 ("waste",       ["562"], "Waste and remediation", "Utilities and waste", "moving", "industrial-warehouse", 1500, 520, 0, 0.02, 0.019, 0.6, "local", "logistics"),
 ("education",   ["61"], "Schools and colleges (private)", "Education and social care", "other", "office", 400, 3900, 0.9, 0.03, 0.028, 0.0, "local", "medical"),
 ("ambulatory",  ["621"], "Doctors, dentists and clinics", "Health care", "other", "office", 300, 8400, 0.26, 0.03, 0.035, 0.0, "local", "medical"),
 ("hospitals",   ["622"], "Hospitals", "Health care", "other", "special", 0, 5300, 1, 0.01, 0.014, 0.0, "local", "medical"),
 ("nursing",     ["623"], "Nursing and residential care", "Health care", "other", "special", 0, 3450, 1, 0.01, 0.021, 0.0, "local", "medical"),
 ("social",      ["624"], "Childcare and social services", "Education and social care", "other", "retail", 400, 4600, 0.75, 0.03, 0.048, 0.0, "local", "medical"),
 ("arts",        ["711AS"], "Theatres, sport and museums", "Hotels and leisure", "selling", "retail", 600, 550, 0.7, 0.05, 0.011, 0.8, "local", "food"),
 ("recreation",  ["713"], "Gyms, amusements and gambling", "Hotels and leisure", "selling", "retail", 800, 1950, 0, 0.02, 0.026, 0.8, "local", "food"),
 ("hotels",      ["721"], "Hotels", "Hotels and leisure", "selling", "special", 0, 2000, 1, 0.01, 0.009, 1.4, "local", "food"),
 ("restaurants", ["722"], "Restaurants and bars", "Restaurants and bars", "selling", "retail", 250, 12400, 0, 0.01, 0.021, 0.5, "local", "food"),
 ("otherservices",["81"], "Repair, personal care and nonprofits", "Personal services and repair", "selling", "retail", 450, 5800, 0, 0.08, 0.011, 0.6, "local", "food"),
 ("fedDefense",  ["GFGD"], "Federal government: defence", "Government", "other", "special", 0, 780, 1, 0.03, -0.003, 0.0, "local", None),
 ("fedCivil",    ["GFGN", "GFE"], "Federal government: civilian and postal", "Government", "other", "office", 230, 2210, 0.64, 0.05, -0.003, 0.0, "local", None),
 ("slGov",       ["GSLG"], "State and local government", "Government", "other", "special", 0, 18960, 1, 0.03, 0.009, 0.0, "local", None),
 ("slEnt",       ["GSLE"], "City enterprises (transit, water, port)", "Utilities and waste", "other", "special", 0, 1000, 1, 0.02, 0.009, 0.0, "local", None),
]

wb = openpyxl.load_workbook(XLSX, read_only=True)
rows = list(wb['2023'].iter_rows(values_only=True))
hdr = rows[5]
col = {c: i for i, c in enumerate(hdr) if c}
row = {}
for i, r in enumerate(rows):
    if r and r[0] and i >= 7:
        row[r[0]] = r
def v(x):
    return float(x) if isinstance(x, (int, float)) else 0.0
def cell(rc, cc):
    return v(row[rc][col[cc]])

def parts(codes):
    out = []
    for c in codes:
        if '*' in c:
            k, s = c.split('*'); out.append((k, float(s)))
        else:
            out.append((c, 1.0))
    return out

# AN INDUSTRY CUT FROM PART OF A BEA COLUMN (`code*share`) takes that share of
# the column's output, inputs and value added. For the brokers' industry that is
# wrong for its PAY: "Other real estate" (ORE) output is mostly rent (86%, paid
# to landlords, see `rent` below), but most of the people ORE employs are the
# brokers' and managers'. Taking 14% of ORE's compensation paid 1.73m workers
# $11k a year each. So its compensation is ORE's (V001) at the brokers' and
# managers' share of NAICS 531 wages, and its employment theirs - BLS QCEW
# 2023 annual averages, private: NAICS 5312 355,726 jobs and $30.25bn of wages,
# 5313 816,339 and $61.00bn, of 531's 1,798,275 and $135.64bn - the difference
# out of its operating surplus, so its column still closes. (No other industry
# is cut from part of a column.)
COMP_SHARE = {'realestate': (30253186343 + 61003935850) / 135641780759}

IDS = [f[0] for f in F]
P = {f[0]: parts(f[1]) for f in F}
IND_COLS = [c for c in hdr[2:73] if c]
FD = ['F010', 'F02S', 'F02E', 'F02N', 'F02R', 'F030', 'F040', 'F050', 'F06C', 'F06S', 'F06E', 'F06N', 'F07C', 'F07S', 'F07E', 'F07N', 'F10C', 'F10S', 'F10E', 'F10N']
COMMS = [r for r in row if r in col or r in ('HS', 'ORE')]

def industry_out(i):  # total output of id i: its columns' Total Industry Output row
    tot = row[None] if None in row else None
    return sum(s * col_total(c) for c, s in P[i])
TOTROW = None
for r in rows:
    if r and r[1] == 'Total Industry Output': TOTROW = r
def col_total(c):
    return v(TOTROW[col[c]])
def bought(i, comm_codes):  # $m of the commodity (list of (code, share)) bought by industry i
    return sum(si * sc * cell(rc, c) for c, si in P[i] for rc, sc in comm_codes)
def comm_use(comm_codes, cols):
    return sum(sc * cell(rc, c) for rc, sc in comm_codes for c in cols)

x = {i: industry_out(i) for i in IDS}
compMoved = {}
data = {}
A = {}
for i in IDS:
    xi = x[i]
    va = lambda code: sum(si * cell(code, c) for c, si in P[i])
    comp, ptax, gos = va('V001') / xi, va('V002') / xi, va('V003') / xi
    if i in COMP_SHARE:
        (code, _), = P[i]
        moved = COMP_SHARE[i] * cell('V001', code) / xi - comp
        comp, gos = comp + moved, gos - moved
        compMoved[i] = moved * xi
    rent = (bought(i, [('ORE', 0.86)]) + bought(i, [('HS', 1.0)])) / xi
    primary = (bought(i, [('Used', 1.0)]) + bought(i, [('Other', 1.0)])) / xi
    A[i] = [bought(i, P[j]) / xi for j in IDS]
    oil = (bought(i, [('211', 1.0)]) + bought(i, [('324', 1.0)])) / xi
    # the commodity's uses
    cc = P[i]
    inter = comm_use(cc, IND_COLS)
    inter_con = comm_use(cc, ['23'])
    hh = comm_use(cc, ['F010'])
    inv_firm = comm_use(cc, ['F02E', 'F02N', 'F030'])
    inv_con = comm_use(cc, ['F02S', 'F02R'])
    gov = comm_use(cc, [c for c in FD if c[:3] in ('F06', 'F07', 'F10')])
    exp = comm_use(cc, ['F040'])
    imp = -comm_use(cc, ['F050'])
    out_c = inter + sum(comm_use(cc, [c]) for c in FD)   # commodity output (imports enter negative)
    pos = {'households': hh, 'firms': inter - inter_con + inv_firm, 'government': gov, 'construction': inter_con + inv_con, 'exports': exp}
    pt = sum(max(0, q) for q in pos.values()) or 1
    buyers = {k: round(max(0, q) / pt, 3) for k, q in pos.items()}
    credit = (comm_use(cc, ['F02S', 'F02E', 'F02N', 'F02R', 'F030'])) / pt
    if i in ('banks', 'securities', 'realestate'): credit = 1.0
    data[i] = dict(outM=round(xi), comp=round(comp, 3), prodTax=round(ptax, 3), gos=round(gos, 3), rent=round(rent, 3), primary=round(primary, 3),
                   foreignImport=round(max(0.0, min(1.0, imp / max(1, out_c + imp))), 2) if out_c + imp > 0 else 0.0,
                   foreignExport=round(max(0.0, min(1.0, exp / max(1, out_c))), 2) if out_c > 0 else 0.0,
                   buyers=buyers,
                   exposure=dict(oil=round(oil, 3), credit=round(max(0, min(1, credit)), 2), construction=buyers['construction'], world=round(max(0.0, min(1.0, exp / max(1, out_c))), 2) if out_c > 0 else 0.0),
                   pceBn=round(hh / 1000, 1))

totComp = sum(sum(si * cell('V001', c) for c, si in P[i]) for i in IDS) + sum(compMoved.values())
totEmp = sum(f[7] for f in F)
compPerWorker = totComp * 1e6 / (totEmp * 1e3)

L = []
L.append('// GENERATED by tools/gen-industries.py from the BEA 2023 summary Use table (Before Redefinitions,')
L.append('// producers\' prices; IOUse_Before_Redefinitions_PRO_1997-2023_Summary.xlsx, sheet 2023, released Sep 2024)')
L.append('// and the hand facts in that script (each sourced there and in industries.ts). Do not edit by hand.')
L.append('import type { Sector } from "./types";')
L.append('')
L.append('export const INDUSTRY_IDS = ' + json.dumps(IDS) + ' as const;')
L.append('export type IndustryId = typeof INDUSTRY_IDS[number];')
L.append('/** Compensation per worker over every industry in the metro\'s accounts, 2023 $: BEA V001 over the employment below [D]. */')
L.append(f'export const COMP_PER_WORKER_2023 = {round(compPerWorker, -2):.0f};')
L.append('export interface IndustryRaw {')
L.append('  bea: readonly string[]; label: string; type: string; group: "making" | "moving" | "selling" | "office" | "other";')
L.append('  space: "office" | "industrial-mfg" | "industrial-warehouse" | "retail" | "special"; sfPerWorker: number; empK: number;')
L.append('  offFloor: number; remote: number; natTrend: number; cycleBeta: number; where: "local" | "regional" | "outside"; financeLike: Sector | null;')
L.append('  outM: number; comp: number; prodTax: number; gos: number; rent: number; primary: number; foreignImport: number; foreignExport: number;')
L.append('  buyers: { households: number; firms: number; government: number; construction: number; exports: number };')
L.append('  exposure: { oil: number; credit: number; construction: number; world: number }; pceBn: number;')
L.append('}')
L.append('export const RAW: Record<IndustryId, IndustryRaw> = {')
for f in F:
    i = f[0]
    d = data[i]
    fac = dict(bea=f[1], label=f[2], type=f[3], group=f[4], space=f[5], sfPerWorker=f[6], empK=f[7], offFloor=f[8], remote=f[9], natTrend=f[10], cycleBeta=f[11], where=f[12], financeLike=f[13])
    fac.update(d)
    L.append(f'  {i}: {json.dumps(fac)},')
L.append('};')
L.append('/** IO_A[i][j]: commodity j bought by industry i per $ of i\'s output (INDUSTRY_IDS order) [D]. */')
L.append('export const IO_RAW: Record<IndustryId, readonly number[]> = {')
for i in IDS:
    L.append(f'  {i}: [{", ".join(f"{a:.4f}".rstrip("0").rstrip(".") if a else "0" for a in A[i])}],')
L.append('};')
open(OUT, 'w').write('\n'.join(L) + '\n')
# report
print('industries', len(IDS), 'emp total', totEmp, 'comp/worker', round(compPerWorker))
for i in IDS:
    d = data[i]; s = d['comp'] + d['prodTax'] + d['gos'] + d['rent'] + d['primary'] + sum(A[i])
    print(f"{i:13s} out {d['outM']:>9} comp {d['comp']:.3f} gos {d['gos']:.3f} rent {d['rent']:.3f} prim {d['primary']:.3f} sumA {sum(A[i]):.3f} closes {s:.3f} imp {d['foreignImport']} exp {d['foreignExport']} pce {d['pceBn']} buyers {d['buyers']}")
