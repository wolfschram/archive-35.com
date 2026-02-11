import React, { useState, useEffect, useCallback } from 'react';

/**
 * PromoCodeManager — Studio tab for creating and managing Stripe promotion codes.
 *
 * Supports:
 *   - Creating coupons (% or $ discount, duration, limits)
 *   - Generating customer-facing promo codes linked to coupons
 *   - Tracking active/inactive codes with usage stats
 *   - One-click copy for handing codes to clients
 *   - Deactivating codes when deals expire
 *
 * All operations go through Electron IPC → Stripe API.
 * Automatically uses test vs. live key based on Studio mode.
 */

const DISCOUNT_PRESETS = [
  { label: '10% Off', percentOff: 10 },
  { label: '15% Off', percentOff: 15 },
  { label: '20% Off', percentOff: 20 },
  { label: '25% Off', percentOff: 25 },
  { label: '50% Off', percentOff: 50 },
  { label: '100% Off (Free)', percentOff: 100 },
  { label: '$50 Off', amountOff: 50 },
  { label: '$100 Off', amountOff: 100 },
  { label: '$250 Off', amountOff: 250 },
];

const DURATION_OPTIONS = [
  { value: 'once', label: 'One-time use' },
  { value: 'forever', label: 'Unlimited (subscription access)' },
  { value: 'repeating', label: 'Repeating (X months)' },
];

const TIER_OPTIONS = [
  { value: '', label: 'All products' },
  { value: 'standard', label: 'Standard License ($300+)' },
  { value: 'premium', label: 'Premium License ($400+)' },
  { value: 'ultra', label: 'Ultra License ($500+)' },
  { value: 'print', label: 'Print Orders' },
];

function PromoCodeManager() {
  // State
  const [promoCodes, setPromoCodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [filter, setFilter] = useState('all'); // all, active, inactive

  // Create form state
  const [formData, setFormData] = useState({
    codeName: '',
    discountType: 'percent', // percent or fixed
    percentOff: 25,
    amountOff: 50,
    duration: 'once',
    durationInMonths: 3,
    maxRedemptions: 1,
    expiryDays: 90,
    clientName: '',
    clientEmail: '',
    tier: '',
    notes: '',
  });

  // ── Load promo codes ──────────────────────────────────────
  const loadPromoCodes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!window.electronAPI?.stripeListPromoCodes) {
        setError('Studio API not available. Run this in the Electron app.');
        setLoading(false);
        return;
      }

      const result = await window.electronAPI.stripeListPromoCodes();
      if (result.success) {
        setPromoCodes(result.data.data || []);
      } else {
        setError(result.error || 'Failed to load promo codes');
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadPromoCodes();
  }, [loadPromoCodes]);

  // ── Create new promo code ─────────────────────────────────
  const handleCreate = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    // Validate code name
    const code = formData.codeName.toUpperCase().replace(/[^A-Z0-9-_]/g, '');
    if (!code || code.length < 3) {
      setError('Code must be at least 3 characters (letters, numbers, dashes)');
      return;
    }

    try {
      // Step 1: Create the coupon (discount definition)
      const couponData = {
        name: `${code} — ${formData.clientName || 'General'}`,
        duration: formData.duration,
        clientName: formData.clientName,
        clientEmail: formData.clientEmail,
        notes: formData.notes,
        tier: formData.tier,
      };

      if (formData.discountType === 'percent') {
        couponData.percentOff = formData.percentOff;
      } else {
        couponData.amountOff = formData.amountOff;
      }

      if (formData.duration === 'repeating') {
        couponData.durationInMonths = formData.durationInMonths;
      }

      // Set expiration on coupon
      if (formData.expiryDays > 0) {
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + formData.expiryDays);
        couponData.redeemBy = Math.floor(expiryDate.getTime() / 1000);
      }

      const couponResult = await window.electronAPI.stripeCreateCoupon(couponData);
      if (!couponResult.success) {
        setError(`Coupon creation failed: ${couponResult.error}`);
        return;
      }

      // Step 2: Create the promotion code linked to the coupon
      const promoData = {
        couponId: couponResult.data.id,
        code: code,
        maxRedemptions: formData.maxRedemptions || undefined,
        clientName: formData.clientName,
        clientEmail: formData.clientEmail,
        notes: formData.notes,
      };

      if (formData.expiryDays > 0) {
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + formData.expiryDays);
        promoData.expiresAt = Math.floor(expiryDate.getTime() / 1000);
      }

      const promoResult = await window.electronAPI.stripeCreatePromoCode(promoData);
      if (!promoResult.success) {
        setError(`Promo code creation failed: ${promoResult.error}`);
        return;
      }

      setSuccessMsg(`Code "${code}" created successfully!`);
      setShowCreateForm(false);
      setFormData({
        codeName: '', discountType: 'percent', percentOff: 25, amountOff: 50,
        duration: 'once', durationInMonths: 3, maxRedemptions: 1, expiryDays: 90,
        clientName: '', clientEmail: '', tier: '', notes: '',
      });
      loadPromoCodes();
    } catch (e) {
      setError(e.message);
    }
  };

  // ── Deactivate a promo code ───────────────────────────────
  const handleDeactivate = async (promoId, code) => {
    if (!window.confirm(`Deactivate code "${code}"? This cannot be undone.`)) return;

    try {
      const result = await window.electronAPI.stripeDeactivatePromoCode(promoId);
      if (result.success) {
        setSuccessMsg(`Code "${code}" deactivated.`);
        loadPromoCodes();
      } else {
        setError(result.error);
      }
    } catch (e) {
      setError(e.message);
    }
  };

  // ── Copy code to clipboard ────────────────────────────────
  const copyCode = (code, id) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  // ── Filter promo codes ────────────────────────────────────
  const filteredCodes = promoCodes.filter(pc => {
    if (filter === 'active') return pc.active;
    if (filter === 'inactive') return !pc.active;
    return true;
  });

  // ── Generate a suggested code name ────────────────────────
  const generateCodeName = () => {
    const client = formData.clientName?.split(' ')[0]?.toUpperCase() || 'A35';
    const year = new Date().getFullYear().toString().slice(-2);
    const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
    setFormData(prev => ({ ...prev, codeName: `${client}-${year}-${rand}` }));
  };

  // ── Helpers ───────────────────────────────────────────────
  const formatDiscount = (coupon) => {
    if (!coupon) return '—';
    if (coupon.percent_off) return `${coupon.percent_off}% off`;
    if (coupon.amount_off) return `$${(coupon.amount_off / 100).toFixed(0)} off`;
    return '—';
  };

  const formatExpiry = (expiresAt) => {
    if (!expiresAt) return 'No expiry';
    const date = new Date(expiresAt * 1000);
    const now = new Date();
    if (date < now) return `Expired ${date.toLocaleDateString()}`;
    const days = Math.ceil((date - now) / (1000 * 60 * 60 * 24));
    return `${date.toLocaleDateString()} (${days}d left)`;
  };

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="page-container" style={{ padding: '24px', maxWidth: 1100 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, color: '#f0f0f0' }}>Promotion Codes</h2>
          <p style={{ margin: '4px 0 0', color: '#888', fontSize: 14 }}>
            Create and manage discount codes for enterprise clients and negotiations
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={loadPromoCodes}
            style={styles.btnSecondary}
            disabled={loading}
          >
            {loading ? 'Loading...' : '↻ Refresh'}
          </button>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            style={showCreateForm ? styles.btnDanger : styles.btnPrimary}
          >
            {showCreateForm ? '✕ Cancel' : '+ New Code'}
          </button>
        </div>
      </div>

      {/* Status messages */}
      {error && (
        <div style={styles.alertError}>
          <strong>Error:</strong> {error}
          <button onClick={() => setError(null)} style={styles.alertClose}>✕</button>
        </div>
      )}
      {successMsg && (
        <div style={styles.alertSuccess}>
          {successMsg}
          <button onClick={() => setSuccessMsg(null)} style={styles.alertClose}>✕</button>
        </div>
      )}

      {/* ── Create Form ────────────────────────────────────── */}
      {showCreateForm && (
        <div style={styles.card}>
          <h3 style={{ margin: '0 0 16px', color: '#f0f0f0' }}>Create New Promotion Code</h3>
          <form onSubmit={handleCreate}>
            <div style={styles.formGrid}>
              {/* Code Name */}
              <div style={styles.formGroup}>
                <label style={styles.label}>Code (what client enters at checkout)</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={formData.codeName}
                    onChange={e => setFormData(prev => ({ ...prev, codeName: e.target.value.toUpperCase() }))}
                    placeholder="e.g., MARRIOTT-2026"
                    style={{ ...styles.input, flex: 1 }}
                    required
                  />
                  <button type="button" onClick={generateCodeName} style={styles.btnSmall}>
                    Auto
                  </button>
                </div>
              </div>

              {/* Discount Type */}
              <div style={styles.formGroup}>
                <label style={styles.label}>Discount</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    value={formData.discountType}
                    onChange={e => setFormData(prev => ({ ...prev, discountType: e.target.value }))}
                    style={{ ...styles.input, width: 120 }}
                  >
                    <option value="percent">% Off</option>
                    <option value="fixed">$ Off</option>
                  </select>
                  {formData.discountType === 'percent' ? (
                    <input
                      type="number"
                      min="1" max="100"
                      value={formData.percentOff}
                      onChange={e => setFormData(prev => ({ ...prev, percentOff: parseInt(e.target.value) || 0 }))}
                      style={{ ...styles.input, width: 80 }}
                    />
                  ) : (
                    <input
                      type="number"
                      min="1"
                      value={formData.amountOff}
                      onChange={e => setFormData(prev => ({ ...prev, amountOff: parseInt(e.target.value) || 0 }))}
                      style={{ ...styles.input, width: 100 }}
                      placeholder="$"
                    />
                  )}
                </div>
                {/* Quick presets */}
                <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                  {DISCOUNT_PRESETS.map(p => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setFormData(prev => ({
                        ...prev,
                        discountType: p.percentOff ? 'percent' : 'fixed',
                        percentOff: p.percentOff || prev.percentOff,
                        amountOff: p.amountOff || prev.amountOff,
                      }))}
                      style={styles.chipBtn}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Duration */}
              <div style={styles.formGroup}>
                <label style={styles.label}>Duration</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    value={formData.duration}
                    onChange={e => setFormData(prev => ({ ...prev, duration: e.target.value }))}
                    style={{ ...styles.input, flex: 1 }}
                  >
                    {DURATION_OPTIONS.map(d => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                  {formData.duration === 'repeating' && (
                    <input
                      type="number"
                      min="1" max="36"
                      value={formData.durationInMonths}
                      onChange={e => setFormData(prev => ({ ...prev, durationInMonths: parseInt(e.target.value) || 1 }))}
                      style={{ ...styles.input, width: 60 }}
                      placeholder="mo"
                    />
                  )}
                </div>
              </div>

              {/* Usage Limit */}
              <div style={styles.formGroup}>
                <label style={styles.label}>Max redemptions (0 = unlimited)</label>
                <input
                  type="number"
                  min="0"
                  value={formData.maxRedemptions}
                  onChange={e => setFormData(prev => ({ ...prev, maxRedemptions: parseInt(e.target.value) || 0 }))}
                  style={styles.input}
                />
              </div>

              {/* Expiry */}
              <div style={styles.formGroup}>
                <label style={styles.label}>Expires in (days, 0 = never)</label>
                <input
                  type="number"
                  min="0"
                  value={formData.expiryDays}
                  onChange={e => setFormData(prev => ({ ...prev, expiryDays: parseInt(e.target.value) || 0 }))}
                  style={styles.input}
                />
              </div>

              {/* Tier */}
              <div style={styles.formGroup}>
                <label style={styles.label}>Restrict to tier</label>
                <select
                  value={formData.tier}
                  onChange={e => setFormData(prev => ({ ...prev, tier: e.target.value }))}
                  style={styles.input}
                >
                  {TIER_OPTIONS.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              {/* Client Info */}
              <div style={styles.formGroup}>
                <label style={styles.label}>Client name (internal tracking)</label>
                <input
                  type="text"
                  value={formData.clientName}
                  onChange={e => setFormData(prev => ({ ...prev, clientName: e.target.value }))}
                  placeholder="e.g., Marriott International"
                  style={styles.input}
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Client email</label>
                <input
                  type="email"
                  value={formData.clientEmail}
                  onChange={e => setFormData(prev => ({ ...prev, clientEmail: e.target.value }))}
                  placeholder="buyer@company.com"
                  style={styles.input}
                />
              </div>

              {/* Notes */}
              <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}>
                <label style={styles.label}>Internal notes</label>
                <textarea
                  value={formData.notes}
                  onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Deal terms, negotiation context, etc."
                  style={{ ...styles.input, minHeight: 60, resize: 'vertical' }}
                />
              </div>
            </div>

            {/* Preview */}
            <div style={styles.previewBox}>
              <strong>Preview:</strong> Code{' '}
              <span style={styles.codeBadge}>{formData.codeName || '???'}</span>
              {' → '}
              {formData.discountType === 'percent'
                ? `${formData.percentOff}% off`
                : `$${formData.amountOff} off`}
              {' • '}
              {DURATION_OPTIONS.find(d => d.value === formData.duration)?.label}
              {formData.maxRedemptions > 0 && ` • ${formData.maxRedemptions} use${formData.maxRedemptions > 1 ? 's' : ''}`}
              {formData.expiryDays > 0 && ` • Expires in ${formData.expiryDays} days`}
              {formData.clientName && ` • For: ${formData.clientName}`}
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <button type="submit" style={styles.btnPrimary}>
                Create Promotion Code
              </button>
              <button type="button" onClick={() => setShowCreateForm(false)} style={styles.btnSecondary}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Filter Tabs ───────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[
          { key: 'all', label: `All (${promoCodes.length})` },
          { key: 'active', label: `Active (${promoCodes.filter(pc => pc.active).length})` },
          { key: 'inactive', label: `Inactive (${promoCodes.filter(pc => !pc.active).length})` },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={filter === f.key ? styles.filterActive : styles.filterBtn}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Promo Codes Table ─────────────────────────────── */}
      {loading && <p style={{ color: '#888' }}>Loading promotion codes from Stripe...</p>}

      {!loading && filteredCodes.length === 0 && (
        <div style={styles.emptyState}>
          <p style={{ fontSize: 18, margin: '0 0 8px' }}>No promotion codes yet</p>
          <p style={{ color: '#888', margin: 0 }}>
            Click "+ New Code" to create your first discount code for enterprise clients.
          </p>
        </div>
      )}

      {!loading && filteredCodes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filteredCodes.map(pc => (
            <div key={pc.id} style={{
              ...styles.card,
              opacity: pc.active ? 1 : 0.6,
              borderLeft: pc.active ? '3px solid #c9a84c' : '3px solid #555',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  {/* Code + Status */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span style={styles.codeBadgeLarge}>{pc.code}</span>
                    <span style={pc.active ? styles.statusActive : styles.statusInactive}>
                      {pc.active ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                    <span style={styles.discountBadge}>{formatDiscount(pc.coupon)}</span>
                  </div>

                  {/* Details row */}
                  <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 13, color: '#aaa' }}>
                    {pc.coupon?.duration && (
                      <span>Duration: {pc.coupon.duration === 'repeating'
                        ? `${pc.coupon.duration_in_months} months`
                        : pc.coupon.duration}</span>
                    )}
                    {pc.max_redemptions && (
                      <span>Uses: {pc.times_redeemed || 0} / {pc.max_redemptions}</span>
                    )}
                    {!pc.max_redemptions && (
                      <span>Uses: {pc.times_redeemed || 0} (unlimited)</span>
                    )}
                    <span>{formatExpiry(pc.expires_at)}</span>
                    {pc.metadata?.client_name && <span>Client: {pc.metadata.client_name}</span>}
                    {pc.metadata?.client_email && <span>{pc.metadata.client_email}</span>}
                  </div>

                  {/* Notes */}
                  {pc.metadata?.notes && (
                    <div style={{ marginTop: 6, fontSize: 12, color: '#777', fontStyle: 'italic' }}>
                      {pc.metadata.notes}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => copyCode(pc.code, pc.id)}
                    style={styles.btnSmall}
                    title="Copy code to clipboard"
                  >
                    {copiedId === pc.id ? '✓ Copied' : '📋 Copy'}
                  </button>
                  {pc.active && (
                    <button
                      onClick={() => handleDeactivate(pc.id, pc.code)}
                      style={styles.btnSmallDanger}
                      title="Deactivate this code"
                    >
                      Deactivate
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Quick Reference ──────────────────────────────── */}
      <div style={{ ...styles.card, marginTop: 24, background: '#1a1a1a' }}>
        <h4 style={{ margin: '0 0 8px', color: '#c9a84c' }}>Launch Pricing Quick Reference</h4>
        <div style={{ fontSize: 13, color: '#aaa', lineHeight: 1.6 }}>
          <div><strong>Prints (12×8 base):</strong> Paper $45 • Canvas $82 • Wood $92 • Metal $99 • Acrylic $149</div>
          <div><strong>License — Web/Social:</strong> Standard $175 • Premium $280 • Ultra $350</div>
          <div><strong>License — Editorial:</strong> Standard $350 • Premium $525 • Ultra $700</div>
          <div><strong>License — Commercial:</strong> Standard $700 • Premium $1,050 • Ultra $1,400</div>
          <div><strong>License — Hospitality:</strong> Standard $1,400 • Premium $2,450 • Ultra $3,500</div>
          <div><strong>License — Exclusive:</strong> Standard $3,500 • Premium $7,000 • Ultra $10,500</div>
          <div style={{ marginTop: 8 }}><strong>Subscription Tiers (future):</strong></div>
          <div>Creative $49/mo ($490/yr) • Studio $1,200/yr • Enterprise: custom</div>
          <div style={{ marginTop: 4, color: '#777' }}>
            Tip: For subscription clients, create a 100% off code with high max redemptions to simulate unlimited access after they pay the annual fee separately.
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Inline Styles ───────────────────────────────────────────
const styles = {
  card: {
    background: '#1e1e1e',
    borderRadius: 8,
    padding: 20,
    border: '1px solid #333',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  label: {
    fontSize: 12,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  input: {
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: 4,
    color: '#f0f0f0',
    padding: '8px 10px',
    fontSize: 14,
    outline: 'none',
    fontFamily: 'inherit',
  },
  btnPrimary: {
    background: '#c9a84c',
    color: '#000',
    border: 'none',
    borderRadius: 6,
    padding: '10px 20px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  btnSecondary: {
    background: '#333',
    color: '#f0f0f0',
    border: '1px solid #555',
    borderRadius: 6,
    padding: '10px 20px',
    fontSize: 14,
    cursor: 'pointer',
  },
  btnDanger: {
    background: '#8b2020',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '10px 20px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  btnSmall: {
    background: '#333',
    color: '#f0f0f0',
    border: '1px solid #555',
    borderRadius: 4,
    padding: '4px 10px',
    fontSize: 12,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  btnSmallDanger: {
    background: 'transparent',
    color: '#e55',
    border: '1px solid #e55',
    borderRadius: 4,
    padding: '4px 10px',
    fontSize: 12,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  chipBtn: {
    background: '#2a2a2a',
    color: '#ccc',
    border: '1px solid #444',
    borderRadius: 12,
    padding: '2px 10px',
    fontSize: 11,
    cursor: 'pointer',
  },
  codeBadge: {
    background: '#c9a84c',
    color: '#000',
    padding: '2px 8px',
    borderRadius: 4,
    fontFamily: 'monospace',
    fontWeight: 700,
    fontSize: 13,
  },
  codeBadgeLarge: {
    background: '#c9a84c',
    color: '#000',
    padding: '4px 12px',
    borderRadius: 4,
    fontFamily: 'monospace',
    fontWeight: 700,
    fontSize: 16,
    letterSpacing: '1px',
  },
  discountBadge: {
    background: '#2a5a2a',
    color: '#8f8',
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 600,
  },
  statusActive: {
    color: '#4caf50',
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '1px',
  },
  statusInactive: {
    color: '#777',
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '1px',
  },
  filterBtn: {
    background: 'transparent',
    color: '#888',
    border: '1px solid #444',
    borderRadius: 4,
    padding: '6px 14px',
    fontSize: 13,
    cursor: 'pointer',
  },
  filterActive: {
    background: '#c9a84c22',
    color: '#c9a84c',
    border: '1px solid #c9a84c',
    borderRadius: 4,
    padding: '6px 14px',
    fontSize: 13,
    cursor: 'pointer',
    fontWeight: 600,
  },
  previewBox: {
    background: '#252525',
    border: '1px solid #444',
    borderRadius: 6,
    padding: 12,
    marginTop: 16,
    fontSize: 13,
    color: '#ccc',
  },
  alertError: {
    background: '#3a1a1a',
    border: '1px solid #e55',
    borderRadius: 6,
    padding: '10px 14px',
    marginBottom: 16,
    color: '#faa',
    fontSize: 14,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  alertSuccess: {
    background: '#1a3a1a',
    border: '1px solid #4a4',
    borderRadius: 6,
    padding: '10px 14px',
    marginBottom: 16,
    color: '#afa',
    fontSize: 14,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  alertClose: {
    background: 'none',
    border: 'none',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: 16,
    padding: '0 4px',
  },
  emptyState: {
    textAlign: 'center',
    padding: '60px 20px',
    color: '#aaa',
  },
};

export default PromoCodeManager;
