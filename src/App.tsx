/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as React from 'react';
import { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  Upload, 
  Settings, 
  History, 
  LogOut, 
  Search, 
  Filter, 
  Download, 
  RefreshCcw,
  Package,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
  ChevronRight,
  Menu,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'react-hot-toast';
import { format } from 'date-fns';

// --- Types ---
interface Order {
  id: string;
  tracking_id: string;
  consignment_id: string;
  courier_name: string;
  status: string;
  status_timestamp: string;
  last_webhook_update: string | null;
}

interface WebhookLog {
  id: string;
  courier: string;
  payload: any;
  timestamp: string;
}

interface ApiSettings {
  pathao_client_id: string;
  pathao_client_secret: string;
  carrybee_api_key: string;
  pathao_webhook_secret: string;
  carrybee_webhook_secret: string;
}

// --- Components ---

const StatusBadge = ({ status }: { status: string }) => {
  const styles: Record<string, string> = {
    'Delivered': 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'Pending': 'bg-slate-100 text-slate-500 border-slate-200',
    'Processing': 'bg-indigo-100 text-indigo-700 border-indigo-200',
    'On the way': 'bg-amber-100 text-amber-700 border-amber-200',
    'Failed': 'bg-rose-100 text-rose-700 border-rose-200',
    'Returned': 'bg-orange-100 text-orange-700 border-orange-200',
    'Partial Delivered': 'bg-orange-100 text-orange-700 border-orange-200',
    'On Hold': 'bg-slate-100 text-slate-600 border-slate-300',
    'Exchange': 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200',
  };

  const currentStyle = styles[status] || 'bg-slate-50 text-slate-400 border-slate-100';

  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${currentStyle} uppercase tracking-wider`}>
      {status}
    </span>
  );
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'logs' | 'settings'>('dashboard');
  const [orders, setOrders] = useState<Order[]>([]);
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [settings, setSettings] = useState<ApiSettings>({
    pathao_client_id: '',
    pathao_client_secret: '',
    carrybee_api_key: '',
    pathao_webhook_secret: '',
    carrybee_webhook_secret: '',
  });
  const [appUrl, setAppUrl] = useState('');
  const [search, setSearch] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);

  // Auth local storage check
  useEffect(() => {
    const token = localStorage.getItem('fleettrack_token');
    if (token) setIsAuthenticated(true);
    
    fetchOrders();
    fetchLogs();
    fetchSettings();
    fetchAppInfo();
  }, []);

  // Polling for updates if there are active orders
  useEffect(() => {
    if (!isAuthenticated) return;

    const needsPolling = orders.some(o => !['Delivered', 'Failed', 'Returned'].includes(o.status));
    
    if (needsPolling || isFetching) {
      const interval = setInterval(() => {
        fetchOrders();
        fetchLogs();
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [orders, isAuthenticated, isFetching]);

  const fetchAppInfo = async () => {
    try {
      const res = await fetch('/api/info');
      const data = await res.json();
      setAppUrl(data.appUrl);
    } catch (e) {}
  };

  const fetchOrders = async () => {
    try {
      const res = await fetch('/api/orders');
      const data = await res.json();
      setOrders(data);
    } catch (e) {
      toast.error('Failed to load orders');
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/logs');
      const data = await res.json();
      setLogs(data);
    } catch (e) {
      toast.error('Failed to load logs');
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      setSettings(data);
    } catch (e) {
      toast.error('Failed to load settings');
    }
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const { username, password } = Object.fromEntries(formData);
    
    if (username === 'admin' && password === 'admin123') {
      localStorage.setItem('fleettrack_token', 'mock');
      setIsAuthenticated(true);
      toast.success('Welcome back, Admin');
    } else {
      toast.error('Invalid credentials');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('fleettrack_token');
    setIsAuthenticated(false);
  };

  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleClearAll = async () => {
    try {
      const res = await fetch('/api/clear-all', { method: 'POST' });
      if (res.ok) {
        fetchOrders();
        toast.success('Database cleared successfully');
        setShowClearConfirm(false);
      } else {
        toast.error('Failed to clear data');
      }
    } catch (e) {
      toast.error('Network error');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message);
        fetchOrders();
      } else {
        toast.error(data.error);
      }
    } catch (e) {
      toast.error('Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleBulkFetch = async () => {
    setIsFetching(true);
    try {
      const res = await fetch('/api/bulk-fetch', { method: 'POST' });
      const data = await res.json();
      toast.success(data.message);
      // Wait a bit and refresh
      setTimeout(fetchOrders, 2000);
    } catch (e) {
      toast.error('Bulk fetch failed');
    } finally {
      setIsFetching(false);
    }
  };

  const handleTestWebhook = async (courier: string) => {
    const targetOrder = orders.find(o => o.courier_name === courier);
    if (!targetOrder) {
      toast.error(`No ${courier} orders found to test with`);
      return;
    }

    try {
      const res = await fetch('/api/test-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courier, consignment_id: targetOrder.consignment_id || targetOrder.tracking_id }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message);
        setTimeout(fetchLogs, 1000);
        setTimeout(fetchOrders, 1500);
      } else {
        toast.error(data.error);
      }
    } catch (e) {
      toast.error('Test failed');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (res.ok) toast.success('Settings updated');
    } catch (e) {
      toast.error('Save failed');
    }
  };

  const filteredOrders = orders.filter(o => 
    o.tracking_id.toLowerCase().includes(search.toLowerCase()) ||
    o.consignment_id.toLowerCase().includes(search.toLowerCase()) ||
    o.courier_name.toLowerCase().includes(search.toLowerCase())
  );

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#F5F5F3] flex items-center justify-center p-6 font-sans">
        <Toaster position="top-right" />
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm bg-white border border-[#E4E3E0] p-8 shadow-sm"
        >
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-[#141414]">FleetTrack Pro</h1>
            <p className="text-sm text-[#8E9299] mt-1">Courier Operations Portal</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-[10px] uppercase font-bold text-[#8E9299] tracking-wider mb-1.5">Username</label>
              <input 
                name="username"
                type="text" 
                defaultValue="admin"
                className="w-full bg-[#F5F5F3] border border-[#E4E3E0] px-4 py-2.5 outline-none focus:border-[#141414] transition-colors text-sm"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase font-bold text-[#8E9299] tracking-wider mb-1.5">Password</label>
              <input 
                name="password"
                type="password" 
                defaultValue="admin123"
                className="w-full bg-[#F5F5F3] border border-[#E4E3E0] px-4 py-2.5 outline-none focus:border-[#141414] transition-colors text-sm"
              />
            </div>
            <button className="w-full bg-[#141414] text-white py-3 font-medium text-sm hover:bg-black transition-colors flex items-center justify-center gap-2 mt-4">
              Access Dashboard
              <ChevronRight size={16} />
            </button>
          </form>
          <p className="text-[10px] text-center text-[#8E9299] mt-6">
            © 2026 FleetTrack Logistics Systems
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F3] text-[#141414] font-sans flex overflow-hidden">
      <Toaster position="top-right" />
      
      {/* Sidebar */}
      <AnimatePresence mode="wait">
        {isSidebarOpen && (
          <motion.div 
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="h-screen bg-white border-r border-[#E4E3E0] flex flex-col z-30 shrink-0 shadow-xl lg:shadow-none"
          >
            <div className="p-6 border-bottom border-[#E4E3E0] flex items-center justify-between">
              <div>
                <h1 className="font-bold text-lg tracking-tight">FleetTrack</h1>
                <p className="text-[10px] text-[#8E9299] font-mono">v1.2.0-PRO</p>
              </div>
              <button 
                onClick={() => setIsSidebarOpen(false)}
                className="lg:hidden p-2 hover:bg-[#F5F5F3] rounded-full"
              >
                <X size={20} />
              </button>
            </div>

            <nav className="flex-1 px-4 py-4 space-y-1">
              <button 
                onClick={() => setActiveTab('dashboard')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'dashboard' ? 'bg-[#141414] text-white shadow-lg shadow-black/10' : 'text-[#8E9299] hover:text-[#141414] hover:bg-[#F5F5F3]'}`}
              >
                <LayoutDashboard size={18} />
                Dashboard
              </button>
              <button 
                onClick={() => setActiveTab('logs')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'logs' ? 'bg-[#141414] text-white shadow-lg shadow-black/10' : 'text-[#8E9299] hover:text-[#141414] hover:bg-[#F5F5F3]'}`}
              >
                <History size={18} />
                Webhook Logs
              </button>
              <button 
                onClick={() => setActiveTab('settings')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'settings' ? 'bg-[#141414] text-white shadow-lg shadow-black/10' : 'text-[#8E9299] hover:text-[#141414] hover:bg-[#F5F5F3]'}`}
              >
                <Settings size={18} />
                API Credentials
              </button>
            </nav>

            <div className="p-4 border-t border-[#E4E3E0]">
              <div className="bg-[#F5F5F3] p-4 rounded-xl mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <Package size={14} className="text-[#141414]" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#8E9299]">Total Managed</span>
                </div>
                <p className="text-xl font-bold tracking-tight">{orders.length.toLocaleString()}</p>
              </div>
              <button 
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
              >
                <LogOut size={18} />
                Sign Out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Topbar */}
        <header className="h-20 bg-white border-b border-[#E4E3E0] flex items-center justify-between px-6 lg:px-10 shrink-0">
          <div className="flex items-center gap-4">
            {!isSidebarOpen && (
              <button 
                onClick={() => setIsSidebarOpen(true)}
                className="p-2 hover:bg-[#F5F5F3] rounded-lg text-[#141414]"
              >
                <Menu size={24} />
              </button>
            )}
            <div>
              <h2 className="text-lg font-semibold tracking-tight capitalize flex items-center gap-2">
                {activeTab === 'dashboard' ? 'Operations Overview' : activeTab === 'logs' ? 'Data Stream' : 'Configuration'}
                {orders.some(o => !['Delivered', 'Failed', 'Returned'].includes(o.status)) && (
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                )}
              </h2>
              <p className="text-[10px] text-[#8E9299] uppercase tracking-widest font-bold">
                {activeTab === 'dashboard' ? 'Real-time courier fleet status' : activeTab === 'logs' ? 'Incoming webhook events' : 'External service integrations'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center bg-[#F5F5F3] border border-[#E4E3E0] rounded-full px-4 py-1.5 focus-within:border-[#141414] transition-colors">
              <Search size={14} className="text-[#8E9299]" />
              <input 
                type="text" 
                placeholder="Search ID, courier..."
                className="bg-transparent border-none outline-none px-2 text-sm w-48"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            
            {activeTab === 'dashboard' && (
              <div className="flex items-center gap-2">
                <button 
                  onClick={handleBulkFetch}
                  disabled={isFetching}
                  className="flex items-center gap-2 bg-[#141414] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-black transition-all disabled:opacity-50 shadow-lg shadow-black/10"
                >
                  <RefreshCcw size={16} className={isFetching ? 'animate-spin' : ''} />
                  <span className="hidden sm:inline">Refresh All</span>
                </button>
                <a 
                  href="/api/export" 
                  download
                  className="flex items-center gap-2 bg-white border border-[#E4E3E0] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#F5F5F3] transition-all"
                >
                  <Download size={16} />
                  <span className="hidden sm:inline">Export</span>
                </a>
                <a 
                  href="/api/sample-csv" 
                  download
                  className="flex items-center gap-2 bg-slate-100 border border-slate-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-200 transition-all text-slate-600"
                >
                  <Download size={16} />
                  <span className="hidden sm:inline">Sample CSV</span>
                </a>
                <label className="flex items-center gap-2 bg-white border border-[#E4E3E0] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#F5F5F3] transition-all cursor-pointer">
                  <Upload size={16} />
                  <span className="hidden sm:inline">Import</span>
                  <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} disabled={isUploading} />
                </label>
              </div>
            )}
          </div>
        </header>

        {/* View Content */}
        <main className="flex-1 overflow-auto bg-[#F9F9F8] p-6 lg:p-10">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="space-y-8 max-w-[1400px] mx-auto"
              >
                {/* Stats Grid */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <h3 className="text-xl font-bold">Logistics Pulse</h3>
                    <div className="h-4 w-[1px] bg-[#E4E3E0]" />
                    <p className="text-xs text-[#8E9299]">Operational health metrics</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {showClearConfirm ? (
                      <div className="flex items-center gap-2 bg-rose-50 p-1 rounded-lg border border-rose-100">
                        <span className="text-[10px] font-bold text-rose-500 uppercase px-2">Clear Everything?</span>
                        <button 
                          onClick={handleClearAll}
                          className="bg-rose-500 text-white text-[9px] font-bold uppercase px-2 py-1 rounded hover:bg-rose-600 transition-colors"
                        >
                          Yes, Delete
                        </button>
                        <button 
                          onClick={() => setShowClearConfirm(false)}
                          className="bg-slate-200 text-slate-600 text-[9px] font-bold uppercase px-2 py-1 rounded hover:bg-slate-300 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button 
                        onClick={() => setShowClearConfirm(true)}
                        className="text-[10px] font-bold uppercase tracking-widest text-rose-400 hover:text-rose-500 transition-colors"
                      >
                        Clear All Data
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { label: 'Out for Delivery', value: orders.filter(o => o.status === 'On the way').length, icon: Package, color: 'text-amber-500' },
                    { label: 'Completed', value: orders.filter(o => o.status === 'Delivered').length, icon: CheckCircle2, color: 'text-emerald-500' },
                    { label: 'Issues', value: orders.filter(o => ['Failed', 'Returned'].includes(o.status)).length, icon: AlertCircle, color: 'text-rose-500' },
                    { label: 'Pending Fetch', value: orders.filter(o => o.status === 'Pending').length, icon: Clock, color: 'text-slate-400' },
                  ].map((stat, i) => (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.1 }}
                      key={stat.label} 
                      className="bg-white p-6 border border-[#E4E3E0] rounded-2xl group hover:border-[#141414] transition-all"
                    >
                      <div className="flex justify-between items-start mb-4">
                        <div className={`p-2 rounded-lg bg-[#F5F5F3] ${stat.color}`}>
                          <stat.icon size={20} />
                        </div>
                        <ChevronRight size={16} className="text-[#E4E3E0] group-hover:text-[#141414] transition-colors" />
                      </div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#8E9299] mb-1">{stat.label}</p>
                      <h3 className="text-3xl font-bold tracking-tight">{stat.value.toLocaleString()}</h3>
                    </motion.div>
                  ))}
                </div>

                {/* Main Table */}
                <div className="bg-white border border-[#E4E3E0] rounded-2xl overflow-hidden shadow-sm">
                  <div className="p-4 border-b border-[#E4E3E0] flex items-center justify-between bg-[#F9F9F8]/50">
                    <div className="flex items-center gap-4">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#8E9299]">Active Consignments</span>
                      <div className="h-4 w-[1px] bg-[#E4E3E0]" />
                      <span className="text-xs text-[#8E9299]">Showing {filteredOrders.length} of {orders.length}</span>
                    </div>
                    <button className="text-[10px] font-bold uppercase tracking-widest hover:text-[#141414] text-[#8E9299] flex items-center gap-1.5 transition-colors">
                      <Filter size={12} />
                      Refine Search
                    </button>
                  </div>
                  
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-[#F9F9F8] border-b border-[#E4E3E0]">
                        <tr>
                          <th className="px-6 py-4 text-[10px] font-serif italic text-[#8E9299] uppercase tracking-widest">Tracking ID</th>
                          <th className="px-6 py-4 text-[10px] font-serif italic text-[#8E9299] uppercase tracking-widest">Consignment</th>
                          <th className="px-6 py-4 text-[10px] font-serif italic text-[#8E9299] uppercase tracking-widest">Courier</th>
                          <th className="px-6 py-4 text-[10px] font-serif italic text-[#8E9299] uppercase tracking-widest">Status</th>
                          <th className="px-6 py-4 text-[10px] font-serif italic text-[#8E9299] uppercase tracking-widest">Timestamp</th>
                          <th className="px-6 py-4 text-[10px] font-serif italic text-[#8E9299] uppercase tracking-widest text-right">Webhook</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E4E3E0]">
                        {filteredOrders.length > 0 ? (
                          filteredOrders.map((order, i) => (
                            <motion.tr 
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              transition={{ delay: i * 0.01 }}
                              key={order.id} 
                              className="hover:bg-[#F9F9F8] group transition-colors cursor-pointer"
                            >
                              <td className="px-6 py-4 font-mono text-xs font-medium text-[#141414]">{order.tracking_id}</td>
                              <td className="px-6 py-4 text-xs text-[#8E9299]">{order.consignment_id}</td>
                              <td className="px-6 py-4">
                                <span className="flex items-center gap-2 text-xs font-semibold">
                                  <div className={`w-2 h-2 rounded-full ${order.courier_name.toLowerCase() === 'pathao' ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                                  {order.courier_name}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <StatusBadge status={order.status} />
                              </td>
                              <td className="px-6 py-4 text-xs font-mono text-[#8E9299]">
                                {format(new Date(order.status_timestamp), 'dd MMM, HH:mm')}
                              </td>
                              <td className="px-6 py-4 text-right">
                                {order.last_webhook_update ? (
                                  <div className="flex flex-col items-end">
                                    <span className="inline-flex items-center gap-1.5 text-[10px] text-emerald-600 font-bold uppercase tracking-wider">
                                      <div className="w-1 h-1 bg-emerald-600 rounded-full animate-pulse" />
                                      Live Update
                                    </span>
                                    <span className="text-[9px] text-[#8E9299] font-mono mt-0.5">
                                      {format(new Date(order.last_webhook_update), 'HH:mm:ss')}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-[#E4E3E0] font-bold tracking-widest">—</span>
                                )}
                              </td>
                            </motion.tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={6} className="px-6 py-12 text-center text-[#8E9299] text-sm">
                              No orders found. Import a CSV to get started.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'logs' && (
              <motion.div 
                key="logs"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="max-w-[1400px] mx-auto space-y-6"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold">Webhook Activity</h3>
                  <button 
                    onClick={fetchLogs}
                    className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#8E9299] hover:text-[#141414] transition-colors"
                  >
                    <RefreshCcw size={14} />
                    Refresh Logs
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  {logs.map((log) => (
                    <div key={log.id} className="bg-white border border-[#E4E3E0] rounded-xl overflow-hidden shadow-sm">
                      <div className="px-6 py-4 border-b border-[#E4E3E0] flex items-center justify-between bg-[#F9F9F8]/50">
                        <div className="flex items-center gap-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest ${log.courier.toLowerCase() === 'pathao' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            {log.courier}
                          </span>
                          <span className="text-[10px] font-mono text-[#8E9299]">{format(new Date(log.timestamp), 'yyyy-MM-dd HH:mm:ss.SSS')}</span>
                        </div>
                        <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest border border-emerald-100 px-2 py-0.5 rounded">202 Accepted</span>
                      </div>
                      <pre className="p-6 text-[11px] font-mono bg-white text-[#141414] overflow-x-auto leading-relaxed">
                        {JSON.stringify(log.payload, null, 2)}
                      </pre>
                    </div>
                  ))}
                  {logs.length === 0 && (
                    <div className="bg-white border border-dashed border-[#E4E3E0] rounded-xl p-12 text-center text-[#8E9299]">
                      Waiting for incoming webhook events...
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <motion.div 
                key="settings"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="max-w-2xl mx-auto"
              >
                <div className="bg-white border border-[#E4E3E0] rounded-2xl shadow-sm overflow-hidden">
                  <div className="p-8 border-b border-[#E4E3E0]">
                    <h3 className="text-xl font-bold mb-1">API Integrations</h3>
                    <p className="text-sm text-[#8E9299]">Securely manage your courier service credentials.</p>
                  </div>
                  
                  <form onSubmit={handleSaveSettings} className="p-8 space-y-8">
                    <div className="space-y-6">
                      <div className="pb-4 border-b border-[#F5F5F3]">
                        <h4 className="text-xs font-bold uppercase tracking-widest mb-4 flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                          Pathao Courier
                        </h4>
                        <div className="grid grid-cols-1 gap-4">
                          <div className="p-4 bg-[#F5F5F3] border border-[#E4E3E0] rounded-lg">
                            <label className="text-[10px] font-bold uppercase text-[#8E9299] tracking-wider block mb-2">Webhook URL</label>
                            <div className="flex items-center gap-2">
                              <code className="text-xs bg-white px-2 py-1 border border-[#E4E3E0] rounded flex-1 truncate">
                                {appUrl}/webhooks/pathao
                              </code>
                              <button 
                                type="button"
                                onClick={() => copyToClipboard(`${appUrl}/webhooks/pathao`)}
                                className="p-2 hover:bg-white rounded transition-colors"
                              >
                                <Download size={14} className="rotate-270" />
                              </button>
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold uppercase text-[#8E9299] tracking-wider">Webhook Secret Key</label>
                            <input 
                              type="text" 
                              className="w-full bg-[#F5F5F3] border border-[#E4E3E0] px-4 py-2.5 outline-none focus:border-[#141414] transition-colors text-sm"
                              value={settings.pathao_webhook_secret}
                              onChange={(e) => setSettings({ ...settings, pathao_webhook_secret: e.target.value })}
                              placeholder="f3992ecc-..."
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold uppercase text-[#8E9299] tracking-wider">Client ID</label>
                            <input 
                              type="text" 
                              className="w-full bg-[#F5F5F3] border border-[#E4E3E0] px-4 py-2.5 outline-none focus:border-[#141414] transition-colors text-sm"
                              value={settings.pathao_client_id}
                              onChange={(e) => setSettings({ ...settings, pathao_client_id: e.target.value })}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold uppercase text-[#8E9299] tracking-wider">Client Secret</label>
                            <input 
                              type="password" 
                              className="w-full bg-[#F5F5F3] border border-[#E4E3E0] px-4 py-2.5 outline-none focus:border-[#141414] transition-colors text-sm"
                              value={settings.pathao_client_secret}
                              onChange={(e) => setSettings({ ...settings, pathao_client_secret: e.target.value })}
                            />
                          </div>
                        </div>
                        <div className="mt-4 flex justify-end">
                          <button 
                            type="button"
                            onClick={() => handleTestWebhook('Pathao')}
                            className="text-[10px] font-bold uppercase tracking-widest text-[#141414] border border-[#141414] px-4 py-2 hover:bg-[#141414] hover:text-white transition-all flex items-center gap-2"
                          >
                            <RefreshCcw size={12} />
                            Send Test Event
                          </button>
                        </div>
                      </div>

                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-widest mb-4 flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          CarryBee API
                        </h4>
                        <div className="grid grid-cols-1 gap-4">
                          <div className="p-4 bg-[#F5F5F3] border border-[#E4E3E0] rounded-lg">
                            <label className="text-[10px] font-bold uppercase text-[#8E9299] tracking-wider block mb-2">Webhook URL</label>
                            <div className="flex items-center gap-2">
                              <code className="text-xs bg-white px-2 py-1 border border-[#E4E3E0] rounded flex-1 truncate">
                                {appUrl}/webhooks/carrybee
                              </code>
                              <button 
                                type="button"
                                onClick={() => copyToClipboard(`${appUrl}/webhooks/carrybee`)}
                                className="p-2 hover:bg-white rounded transition-colors"
                              >
                                <Download size={14} className="rotate-270" />
                              </button>
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold uppercase text-[#8E9299] tracking-wider">Webhook Secret Key</label>
                            <input 
                              type="text" 
                              className="w-full bg-[#F5F5F3] border border-[#E4E3E0] px-4 py-2.5 outline-none focus:border-[#141414] transition-colors text-sm"
                              value={settings.carrybee_webhook_secret}
                              onChange={(e) => setSettings({ ...settings, carrybee_webhook_secret: e.target.value })}
                              placeholder="f3992ecc-..."
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold uppercase text-[#8E9299] tracking-wider">API Secret Key</label>
                            <input 
                              type="password" 
                              className="w-full bg-[#F5F5F3] border border-[#E4E3E0] px-4 py-2.5 outline-none focus:border-[#141414] transition-colors text-sm"
                              value={settings.carrybee_api_key}
                              onChange={(e) => setSettings({ ...settings, carrybee_api_key: e.target.value })}
                            />
                          </div>
                        </div>
                        <div className="mt-4 flex justify-end">
                          <button 
                            type="button"
                            onClick={() => handleTestWebhook('CarryBee')}
                            className="text-[10px] font-bold uppercase tracking-widest text-[#141414] border border-[#141414] px-4 py-2 hover:bg-[#141414] hover:text-white transition-all flex items-center gap-2"
                          >
                            <RefreshCcw size={12} />
                            Send Test Event
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex gap-3">
                      <AlertCircle className="text-blue-500 shrink-0" size={18} />
                      <div className="text-[11px] text-blue-700 leading-relaxed">
                        <strong>Security Note:</strong> Keys are stored server-side and only used for authenticated API requests to courier end-points. Never share your webhook secrets.
                      </div>
                    </div>

                    <button className="w-full bg-[#141414] text-white py-3.5 font-bold text-sm hover:bg-black transition-all flex items-center justify-center gap-2 shadow-lg shadow-black/10">
                      Save Credentials
                      <ChevronRight size={18} />
                    </button>
                  </form>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

