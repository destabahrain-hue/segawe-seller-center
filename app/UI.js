import { rp, num, pct } from '@/lib/fmt';
import { IUp, IDown, IWarn, IInfo } from './Icons';

export function Kpi({ label, nilai, delta, sub, lead, warna }) {
  const naik = (delta ?? 0) >= 0;
  return (
    <div className={'kpi' + (lead ? ' kpi-lead' : '')}>
      <div className="k">{label}</div>
      <div className="v num" style={warna ? { color: warna } : undefined}>{nilai}</div>
      <div className="d">
        {delta !== undefined && delta !== null && (
          <span className={'badge ' + (naik ? 'b-pos' : 'b-neg')}>
            {naik ? <IUp strokeWidth={2.2} /> : <IDown strokeWidth={2.2} />}
            {pct(Math.abs(delta))}
          </span>
        )}
        {sub}
      </div>
    </div>
  );
}

/** Pita laba — elemen tanda tangan dashboard. */
export function Ledger({ t, keterangan }) {
  const o = t.omzet || 0;
  const bagi = (v) => (o ? (v / o) * 100 : 0);
  const seg = [
    ['seg-hpp',  'HPP',            t.hpp],
    ['seg-fee',  'Biaya',          t.biaya],
    ['seg-ads',  'Iklan',          t.iklan],
    ['seg-laba', 'Laba',           Math.max(t.laba, 0)],
  ];
  return (
    <div className="ledger">
      <div className="ledger-top">
        <div>
          <div className="ledger-lab">Laba hari ini</div>
          <div className="ledger-big num" style={t.laba < 0 ? { color: 'var(--neg)' } : undefined}>
            {rp(t.laba)}
          </div>
        </div>
        <div className="ledger-meta">
          {t.perkiraan > 0 && (
            <span className="badge b-warn"><IWarn strokeWidth={2} />
              Perkiraan — {t.perkiraan} pesanan menunggu dana Shopee dilepas
            </span>
          )}
          <span className="ledger-omzet">
            Dari omzet <b className="num">{rp(o)}</b> · {num(t.pesanan)} pesanan · {keterangan}
          </span>
        </div>
      </div>

      {o > 0 && (
        <div className="bar" role="img"
             aria-label={`Rincian omzet: HPP ${bagi(t.hpp).toFixed(0)} persen, biaya ${bagi(t.biaya).toFixed(0)} persen, iklan ${bagi(t.iklan).toFixed(0)} persen, laba ${bagi(t.laba).toFixed(0)} persen`}>
          {seg.map(([cls, lab, v]) => bagi(v) > 0 && (
            <div key={cls} className={'seg ' + cls} style={{ width: bagi(v).toFixed(1) + '%' }}>
              <span>{lab} {bagi(v).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      )}

      <div className="legend">
        <Leg cls="leg-hpp"  k="HPP"            v={t.hpp}   p="dari Master SKU" />
        <Leg cls="leg-fee"  k="Biaya platform" v={t.biaya} p={t.perkiraan ? 'sebagian perkiraan' : 'dari data Shopee'} />
        <Leg cls="leg-ads"  k="Iklan + PPN"    v={t.iklan}
             p={t.iklanPokok
                 ? `termasuk PPN ${rp(t.iklanPpn)} · ROAS ${(o / t.iklan).toFixed(1)}×`
                 : 'belum ada data'} />
        <Leg cls="leg-laba" k="Laba bersih"    v={t.laba}  p={`margin ${pct(t.margin)}`} />
      </div>
    </div>
  );
}
function Leg({ cls, k, v, p }) {
  return (
    <div className={'leg ' + cls}>
      <span className="k">{k}</span>
      <span className="v num">{rp(v)}</span>
      <span className="p">{p}</span>
    </div>
  );
}

export function Kosong({ judul, anak }) {
  return <div className="empty"><h3>{judul}</h3><p>{anak}</p></div>;
}

export function Catatan({ children }) {
  return <div className="note"><IInfo strokeWidth={2} /><div>{children}</div></div>;
}

export function Batang({ data, tinggi = 190, kunciX = 'label', kunciY = 'omzet', kunciGaris = 'laba' }) {
  if (!data.length) return <Kosong judul="Belum ada data" anak="Data muncul setelah sinkronisasi pertama." />;
  const X0 = 58, X1 = 1130, Y0 = 18, Y1 = tinggi - 34;
  const mx = Math.max(...data.map((d) => Number(d[kunciY]) || 0), 1);
  const slot = (X1 - X0) / data.length;
  const bw = Math.min(slot * 0.5, 26);
  const garis = data.map((d, i) =>
    `${X0 + slot * i + slot / 2},${Y1 - ((Number(d[kunciGaris]) || 0) / mx) * (Y1 - Y0)}`).join(' ');
  return (
    <svg className="chart" viewBox={`0 0 1160 ${tinggi}`} role="img"
         aria-label="Grafik omzet sebagai batang dan laba sebagai garis">
      {[0, 1, 2, 3].map((i) => {
        const y = Y0 + ((Y1 - Y0) * i) / 3;
        return (
          <g key={i}>
            <line className="gridline" x1={X0} y1={y} x2={X1} y2={y} />
            <text className="axis-t" x={X0 - 8} y={y + 4} textAnchor="end">
              {((mx * (3 - i)) / 3 / 1e6).toFixed(1)} jt
            </text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const cx = X0 + slot * i + slot / 2;
        const h = ((Number(d[kunciY]) || 0) / mx) * (Y1 - Y0);
        return (
          <rect key={i} className="bar-y" x={cx - bw / 2} y={Y1 - h} width={bw} height={h} rx="2">
            <title>{d[kunciX]} — {rp(d[kunciY])}</title>
          </rect>
        );
      })}
      <polyline className="line-laba" points={garis} />
      {data.map((d, i) => (
        (i % Math.ceil(data.length / 8) === 0 || i === data.length - 1) && (
          <text key={'x' + i} className="axis-t" x={X0 + slot * i + slot / 2} y={Y1 + 18} textAnchor="middle">
            {d[kunciX]}
          </text>
        )
      ))}
    </svg>
  );
}

/**
 * Panel error yang bisa dibaca. Next.js menyembunyikan pesan error di
 * mode produksi dan hanya menampilkan "Application error" plus digest —
 * tidak berguna untuk memperbaiki. Jadi error ditangkap sendiri dan
 * isinya ditampilkan apa adanya.
 */
export function Galat({ judul = 'Halaman ini gagal dimuat', pesan, detail }) {
  return (
    <div className="card" style={{ borderColor: 'var(--neg)' }}>
      <div className="card-head" style={{ background: 'var(--neg-tint)' }}>
        <IWarn strokeWidth={2} style={{ width: 16, height: 16, color: 'var(--neg)' }} />
        <h2 style={{ color: 'var(--neg)' }}>{judul}</h2>
      </div>
      <div className="card-body">
        <p style={{ margin: 0, fontWeight: 600 }}>{pesan || 'Tidak ada pesan error.'}</p>
        {detail && (
          <pre style={{
            marginTop: 'var(--s3)', padding: 'var(--s3)', background: 'var(--surface-sunken)',
            border: '1px solid var(--line)', borderRadius: 'var(--r-sm)',
            fontSize: 11.5, whiteSpace: 'pre-wrap', overflowX: 'auto', color: 'var(--ink-2)',
          }}>{detail}</pre>
        )}
        <p className="t-mute" style={{ fontSize: 12, marginTop: 'var(--s3)' }}>
          Salin pesan di atas apa adanya — itu yang dibutuhkan untuk memperbaiki.
        </p>
      </div>
    </div>
  );
}
