'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { StatusBadge } from './status-badge';

export interface OrderItem {
  id: string;
  base_amount: number;
  offset_cents: number;
  final_amount: string | number;
  status: string;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  utr?: string | null;
  vpa_address?: string | null;
  created_at: string;
  paid_at?: string | null;
  expires_at?: string;
  metadata?: any;
}

interface TransactionsManagerProps {
  initialOrders: OrderItem[];
}

export const TransactionsManager: React.FC<TransactionsManagerProps> = ({ initialOrders }) => {
  const [orders, setOrders] = useState<OrderItem[]>(initialOrders);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');

  // Edit Modal State
  const [editingOrder, setEditingOrder] = useState<OrderItem | null>(null);
  const [editStatus, setEditStatus] = useState<string>('pending');
  const [editUtr, setEditUtr] = useState<string>('');
  const [editBaseAmount, setEditBaseAmount] = useState<string>('');
  const [editFinalAmount, setEditFinalAmount] = useState<string>('');
  const [editCustomerName, setEditCustomerName] = useState<string>('');
  const [editCustomerEmail, setEditCustomerEmail] = useState<string>('');
  const [savingEdit, setSavingEdit] = useState<boolean>(false);

  // Create Modal State
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [createAmount, setCreateAmount] = useState<string>('');
  const [createStatus, setCreateStatus] = useState<string>('paid');
  const [createUtr, setCreateUtr] = useState<string>('');
  const [createCustomerName, setCreateCustomerName] = useState<string>('');
  const [createCustomerEmail, setCreateCustomerEmail] = useState<string>('');
  const [creating, setCreating] = useState<boolean>(false);

  // Delete State
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Status counts
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: orders.length, paid: 0, pending: 0, expired: 0, failed: 0 };
    orders.forEach((o) => {
      const s = (o.status || 'pending').toLowerCase();
      if (counts[s] !== undefined) counts[s]++;
    });
    return counts;
  }, [orders]);

  // Filtered orders
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      const matchesStatus = statusFilter === 'all' || (o.status || '').toLowerCase() === statusFilter;
      if (!matchesStatus) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        o.id.toLowerCase().includes(q) ||
        (o.customer_name || '').toLowerCase().includes(q) ||
        (o.customer_email || '').toLowerCase().includes(q) ||
        (o.utr || '').toLowerCase().includes(q) ||
        String(o.base_amount).includes(q) ||
        String(o.final_amount).includes(q)
      );
    });
  }, [orders, statusFilter, searchQuery]);

  // Refresh orders from API
  const refreshOrders = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/v1/dashboard/orders');
      const data = await res.json();
      if (res.ok && data.orders) {
        setOrders(data.orders);
      }
    } catch (err: any) {
      setErrorMsg('Failed to refresh transactions');
    } finally {
      setLoading(false);
    }
  };

  // Open Edit Modal
  const openEditModal = (order: OrderItem) => {
    setEditingOrder(order);
    setEditStatus(order.status || 'pending');
    setEditUtr(order.utr || '');
    setEditBaseAmount(String(order.base_amount));
    setEditFinalAmount(String(parseFloat(String(order.final_amount)).toFixed(2)));
    setEditCustomerName(order.customer_name || '');
    setEditCustomerEmail(order.customer_email || '');
    setErrorMsg('');
  };

  // Save Edit Changes
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrder) return;
    setSavingEdit(true);
    setErrorMsg('');

    try {
      const res = await fetch(`/api/v1/dashboard/orders/${editingOrder.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: editStatus,
          utr: editUtr,
          base_amount: editBaseAmount,
          final_amount: editFinalAmount,
          customer_name: editCustomerName,
          customer_email: editCustomerEmail,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update order');
      }

      setOrders((prev) =>
        prev.map((o) => (o.id === editingOrder.id ? { ...o, ...data.order } : o))
      );
      setSuccessMsg(`Order ${editingOrder.id} updated successfully`);
      setEditingOrder(null);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error updating order');
    } finally {
      setSavingEdit(false);
    }
  };

  // Quick Mark as Paid
  const handleQuickMarkPaid = async (orderId: string) => {
    const inputUtr = window.prompt(`Enter Bank UTR for ${orderId} (optional):`, '');
    if (inputUtr === null) return; // User clicked cancel

    try {
      const res = await fetch(`/api/v1/dashboard/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'paid',
          utr: inputUtr.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setOrders((prev) =>
          prev.map((o) => (o.id === orderId ? { ...o, ...data.order } : o))
        );
        setSuccessMsg(`Order ${orderId} marked as PAID`);
        setTimeout(() => setSuccessMsg(''), 4000);
      } else {
        alert(data.error || 'Failed to update order');
      }
    } catch (err: any) {
      alert(err.message || 'Error updating order');
    }
  };

  // Delete Order
  const handleDeleteOrder = async (orderId: string) => {
    if (!window.confirm(`Are you sure you want to permanently delete payment record ${orderId}?`)) {
      return;
    }

    setDeletingId(orderId);
    try {
      const res = await fetch(`/api/v1/dashboard/orders/${orderId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setOrders((prev) => prev.filter((o) => o.id !== orderId));
        setSuccessMsg(`Order ${orderId} deleted permanently`);
        setTimeout(() => setSuccessMsg(''), 4000);
      } else {
        alert(data.error || 'Failed to delete order');
      }
    } catch (err: any) {
      alert(err.message || 'Error deleting order');
    } finally {
      setDeletingId(null);
    }
  };

  // Create Manual Order
  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(createAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setErrorMsg('Please enter a valid amount');
      return;
    }

    setCreating(true);
    setErrorMsg('');

    try {
      const res = await fetch('/api/v1/dashboard/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amountNum,
          status: createStatus,
          utr: createUtr.trim() || undefined,
          customer_name: createCustomerName.trim() || undefined,
          customer_email: createCustomerEmail.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to create record');
      }

      setOrders((prev) => [data.order, ...prev]);
      setShowCreateModal(false);
      setCreateAmount('');
      setCreateUtr('');
      setCreateCustomerName('');
      setCreateCustomerEmail('');
      setSuccessMsg(`Payment record created: ${data.order.id}`);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error creating order');
    } finally {
      setCreating(false);
    }
  };

  // Export CSV
  const handleExportCsv = () => {
    if (filteredOrders.length === 0) {
      alert('No transactions to export');
      return;
    }

    const headers = ['Order ID', 'Customer Name', 'Customer Email', 'Base Amount', 'Final Amount', 'Status', 'UTR', 'Date'];
    const rows = filteredOrders.map((o) => [
      o.id,
      `"${(o.customer_name || '').replace(/"/g, '""')}"`,
      `"${(o.customer_email || '').replace(/"/g, '""')}"`,
      o.base_amount,
      o.final_amount,
      o.status,
      `"${(o.utr || '').replace(/"/g, '""')}"`,
      new Date(o.created_at).toISOString(),
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `fluxpay_transactions_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4 font-mono text-xs">
      {/* Alert Messages */}
      {successMsg && (
        <div className="p-3 bg-emerald-950/40 border border-emerald-800 text-emerald-300 rounded flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg('')} className="text-zinc-400 hover:text-white">✕</button>
        </div>
      )}
      {errorMsg && (
        <div className="p-3 bg-rose-950/40 border border-rose-800 text-rose-300 rounded flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg('')} className="text-zinc-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Main Container */}
      <div className="bg-[#121214] border border-[#27272a] rounded-lg overflow-hidden">
        {/* Header Bar with Actions */}
        <div className="p-4 border-b border-[#27272a] flex flex-wrap items-center justify-between gap-3 bg-[#151518]">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-[#f4f4f5] uppercase tracking-wider">
              PAYMENT RECORDS ({filteredOrders.length})
            </h2>
            <button
              type="button"
              onClick={refreshOrders}
              disabled={loading}
              className="text-[11px] px-2 py-0.5 rounded bg-[#1c1c20] hover:bg-[#27272a] text-zinc-400 hover:text-zinc-200 border border-[#27272a] transition disabled:opacity-50"
              title="Refresh ledger"
            >
              {loading ? 'Refreshing...' : '↻ Refresh'}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportCsv}
              className="px-3 py-1.5 bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-zinc-300 hover:text-white rounded transition text-[11px] font-bold"
            >
              ↓ EXPORT CSV
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCreateModal(true);
                setErrorMsg('');
              }}
              className="px-3 py-1.5 bg-[#ff6600] hover:bg-[#ff7a1a] text-black font-bold rounded transition text-[11px] uppercase tracking-wider"
            >
              + NEW PAYMENT RECORD
            </button>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="p-3 border-b border-[#27272a] bg-[#0b0b0b] flex flex-wrap items-center justify-between gap-3">
          {/* Status Tabs */}
          <div className="flex items-center gap-1">
            {(['all', 'paid', 'pending', 'expired', 'failed'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 rounded text-[11px] uppercase font-bold transition flex items-center gap-1.5 ${
                  statusFilter === st
                    ? 'bg-[#27272a] text-[#ff6600] border border-[#3f3f46]'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#18181b]'
                }`}
              >
                <span>{st}</span>
                <span className="text-[10px] px-1 rounded bg-[#121214] text-zinc-400 border border-[#27272a]">
                  {statusCounts[st] || 0}
                </span>
              </button>
            ))}
          </div>

          {/* Search Input */}
          <div className="w-full sm:w-72">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search ID, customer, UTR, amount..."
              className="w-full bg-[#121214] border border-[#27272a] rounded px-3 py-1.5 text-[11px] text-[#f4f4f5] focus:outline-none focus:border-[#ff6600] placeholder:text-zinc-600"
            />
          </div>
        </div>

        {/* Orders Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#0b0b0b] text-[#a1a1aa] border-b border-[#27272a] uppercase text-[11px]">
              <tr>
                <th className="px-4 py-3">ORDER ID</th>
                <th className="px-4 py-3">CUSTOMER</th>
                <th className="px-4 py-3">BASE AMT</th>
                <th className="px-4 py-3">PAID AMT</th>
                <th className="px-4 py-3">STATUS</th>
                <th className="px-4 py-3">BANK UTR</th>
                <th className="px-4 py-3">DATE</th>
                <th className="px-4 py-3 text-right">MANIPULATE</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#27272a]">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-[#71717a]">
                    No matching payment records found.
                  </td>
                </tr>
              ) : (
                filteredOrders.map((o) => (
                  <tr key={o.id} className="hover:bg-[#18181b]/70 transition">
                    <td className="px-4 py-3 text-[#f4f4f5] font-bold">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate max-w-[140px]">{o.id}</span>
                        <Link
                          href={`/pay/${o.id}`}
                          target="_blank"
                          className="text-[10px] text-zinc-500 hover:text-[#ff6600]"
                          title="Open Checkout Link"
                        >
                          ↗
                        </Link>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[#a1a1aa]">
                      <div className="truncate max-w-[150px] font-semibold text-zinc-300">
                        {o.customer_name || 'Anonymous'}
                      </div>
                      {o.customer_email && (
                        <div className="text-[10px] text-zinc-500 truncate max-w-[150px]">
                          {o.customer_email}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[#a1a1aa]">
                      ₹{o.base_amount}
                    </td>
                    <td className="px-4 py-3 text-[#f4f4f5] font-bold">
                      ₹{parseFloat(String(o.final_amount)).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={o.status} />
                    </td>
                    <td className="px-4 py-3 text-zinc-400">
                      {o.utr ? (
                        <span className="text-emerald-400 font-semibold">{o.utr}</span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[10px] text-zinc-500 whitespace-nowrap">
                      {new Date(o.created_at).toLocaleDateString()} {new Date(o.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {o.status !== 'paid' && (
                          <button
                            type="button"
                            onClick={() => handleQuickMarkPaid(o.id)}
                            className="px-2 py-1 bg-emerald-950/60 hover:bg-emerald-900 border border-emerald-800 text-emerald-400 hover:text-emerald-300 rounded text-[10px] font-bold transition"
                            title="Quick Mark as Paid"
                          >
                            MARK PAID
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openEditModal(o)}
                          className="px-2 py-1 bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] hover:border-zinc-500 text-zinc-300 hover:text-white rounded text-[10px] font-bold transition"
                          title="Edit order details"
                        >
                          EDIT
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteOrder(o.id)}
                          disabled={deletingId === o.id}
                          className="px-2 py-1 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-900/50 hover:border-rose-700 text-rose-400 hover:text-rose-300 rounded text-[10px] font-bold transition disabled:opacity-50"
                          title="Delete payment record"
                        >
                          {deletingId === o.id ? '...' : 'DEL'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* EDIT MODAL */}
      {editingOrder && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#121214] border border-[#27272a] rounded-xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#27272a] pb-3">
              <h3 className="text-sm font-bold text-[#f4f4f5] uppercase tracking-wider">
                MANIPULATE PAYMENT RECORD // {editingOrder.id}
              </h3>
              <button
                type="button"
                onClick={() => setEditingOrder(null)}
                className="text-zinc-500 hover:text-white text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-400 text-[10px] uppercase mb-1">Status</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
                >
                  <option value="pending">pending</option>
                  <option value="paid">paid</option>
                  <option value="expired">expired</option>
                  <option value="failed">failed</option>
                </select>
              </div>

              <div>
                <label className="block text-zinc-400 text-[10px] uppercase mb-1">Bank UTR</label>
                <input
                  type="text"
                  value={editUtr}
                  onChange={(e) => setEditUtr(e.target.value)}
                  placeholder="e.g. 524109823412"
                  className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 text-[10px] uppercase mb-1">Base Amount (₹)</label>
                  <input
                    type="number"
                    step="1"
                    value={editBaseAmount}
                    onChange={(e) => setEditBaseAmount(e.target.value)}
                    className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 text-[10px] uppercase mb-1">Final Amount (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editFinalAmount}
                    onChange={(e) => setEditFinalAmount(e.target.value)}
                    className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-zinc-400 text-[10px] uppercase mb-1">Customer Name</label>
                <input
                  type="text"
                  value={editCustomerName}
                  onChange={(e) => setEditCustomerName(e.target.value)}
                  placeholder="Customer Full Name"
                  className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
                />
              </div>

              <div>
                <label className="block text-zinc-400 text-[10px] uppercase mb-1">Customer Email</label>
                <input
                  type="email"
                  value={editCustomerEmail}
                  onChange={(e) => setEditCustomerEmail(e.target.value)}
                  placeholder="customer@example.com"
                  className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-[#27272a]">
                <button
                  type="button"
                  onClick={() => setEditingOrder(null)}
                  className="px-4 py-2 bg-[#18181b] hover:bg-[#27272a] text-zinc-300 rounded font-bold transition"
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-4 py-2 bg-[#ff6600] hover:bg-[#ff7a1a] text-black font-bold rounded transition disabled:opacity-50 uppercase"
                >
                  {savingEdit ? 'SAVING...' : 'SAVE CHANGES'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE MANUAL RECORD MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#121214] border border-[#27272a] rounded-xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#27272a] pb-3">
              <h3 className="text-sm font-bold text-[#f4f4f5] uppercase tracking-wider">
                CREATE MANUAL PAYMENT RECORD
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-zinc-500 hover:text-white text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateOrder} className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-400 text-[10px] uppercase mb-1">Amount (₹) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={createAmount}
                  onChange={(e) => setCreateAmount(e.target.value)}
                  placeholder="e.g. 50.00"
                  className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
                />
              </div>

              <div>
                <label className="block text-zinc-400 text-[10px] uppercase mb-1">Status</label>
                <select
                  value={createStatus}
                  onChange={(e) => setCreateStatus(e.target.value)}
                  className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
                >
                  <option value="paid">paid</option>
                  <option value="pending">pending</option>
                  <option value="expired">expired</option>
                  <option value="failed">failed</option>
                </select>
              </div>

              <div>
                <label className="block text-zinc-400 text-[10px] uppercase mb-1">Bank UTR</label>
                <input
                  type="text"
                  value={createUtr}
                  onChange={(e) => setCreateUtr(e.target.value)}
                  placeholder="e.g. 524109823412"
                  className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
                />
              </div>

              <div>
                <label className="block text-zinc-400 text-[10px] uppercase mb-1">Customer Name</label>
                <input
                  type="text"
                  value={createCustomerName}
                  onChange={(e) => setCreateCustomerName(e.target.value)}
                  placeholder="e.g. Rahul Sharma"
                  className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
                />
              </div>

              <div>
                <label className="block text-zinc-400 text-[10px] uppercase mb-1">Customer Email</label>
                <input
                  type="email"
                  value={createCustomerEmail}
                  onChange={(e) => setCreateCustomerEmail(e.target.value)}
                  placeholder="e.g. rahul@example.com"
                  className="w-full bg-[#0b0b0b] border border-[#27272a] rounded px-3 py-2 text-[#f4f4f5] focus:outline-none focus:border-[#ff6600]"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-[#27272a]">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 bg-[#18181b] hover:bg-[#27272a] text-zinc-300 rounded font-bold transition"
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 bg-[#ff6600] hover:bg-[#ff7a1a] text-black font-bold rounded transition disabled:opacity-50 uppercase"
                >
                  {creating ? 'CREATING...' : 'CREATE RECORD'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
