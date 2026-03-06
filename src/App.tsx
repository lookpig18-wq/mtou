import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  Camera, 
  Upload, 
  History, 
  FileText, 
  Save, 
  Trash2, 
  ChevronRight, 
  Search, 
  CheckCircle2, 
  XCircle,
  Loader2,
  ArrowLeft,
  Info,
  Pencil
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ReadingData, MeterData, MONTHS_TH } from './types';
import * as XLSX from 'xlsx';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export default function App() {
  const [view, setView] = useState<'home' | 'scan' | 'history' | 'detail' | 'report'>('home');
  const [loading, setLoading] = useState(false);
  const [readings, setReadings] = useState<ReadingData[]>([]);
  const [selectedReading, setSelectedReading] = useState<ReadingData | null>(null);
  const [searchName, setSearchName] = useState('');
  const [searchMonth, setSearchMonth] = useState<string>('');
  const [searchYear, setSearchYear] = useState<string>('');
  
  // Form state for new reading
  const [formData, setFormData] = useState<Partial<ReadingData>>({
    customer_name: '',
    customer_id: '',
    pea_meter_no: '',
    reading_month: new Date().getMonth() + 1,
    reading_year: new Date().getFullYear() + 543, // Buddhist Era
    image_base64: '',
    data: {
      codes: {},
      analysis: {
        totalEnergyMatch: false,
        sum010_020_030: 0,
        val111: 0,
        diff015_050: false,
        diff016_060: false,
        diff017_070: false,
        diff118_280: false,
      }
    }
  });

  useEffect(() => {
    if (view === 'history' || view === 'report') {
      fetchReadings();
    }
  }, [view, searchName, searchMonth, searchYear]);

  const fetchReadings = async () => {
    try {
      const params = new URLSearchParams();
      if (searchName) params.append('name', searchName);
      if (searchMonth) params.append('month', searchMonth);
      if (searchYear) params.append('year', searchYear);
      
      const res = await fetch(`/api/readings?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text();
        console.error('Fetch error:', res.status, text);
        return;
      }
      const data = await res.json();
      setReadings(data);
    } catch (error) {
      console.error('Failed to fetch readings:', error);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const base64 = await fileToBase64(file);
      // Set image immediately so user can see it even if OCR is slow or fails
      setFormData(prev => ({ ...prev, image_base64: base64 }));
      
      const extracted = await extractDataFromImage(base64);
      
      if (extracted) {
        setFormData(prev => ({
          ...prev,
          customer_name: extracted.basicInfo?.customerName || prev.customer_name,
          customer_id: extracted.basicInfo?.customerId || prev.customer_id,
          pea_meter_no: extracted.basicInfo?.peaMeterNo || prev.pea_meter_no,
          image_base64: base64, // Ensure it's still there
          data: {
            codes: extracted.codes,
            analysis: extracted.analysis
          }
        }));
      }
    } catch (error) {
      console.error('OCR Error:', error);
      alert('เกิดข้อผิดพลาดในการอ่านข้อมูลจากรูปภาพ แต่คุณยังสามารถกรอกข้อมูลเองได้');
    } finally {
      setLoading(false);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  const extractDataFromImage = async (base64: string) => {
    const prompt = `
      You are an expert at reading PEA TOU meter reading sheets (ใบอ่านหน่วยไฟฟ้า). 
      Extract the following basic information from the top of the sheet:
      - customerName (ชื่อผู้ใช้ไฟฟ้า)
      - customerId (หมายเลขผู้ใช้ไฟฟ้า)
      - peaMeterNo (หมายเลขมิเตอร์ PEA)

      Also extract the following codes and their values from the table:
      111, 010, 020, 030, 015, 016, 017, 118, 050, 060, 070, 280.
      
      For each code, extract:
      - printedValue (ค่าที่พิมพ์มา)
      - handwrittenValue (ค่าที่อ่านได้/ลายมือ)
      - usage (หน่วยที่ใช้)
      
      Also perform these analyses:
      1. sum010_020_030 = sum of 'handwrittenValue' of codes 010, 020, 030.
      2. totalEnergyMatch = Is sum010_020_030 equal to 'handwrittenValue' of code 111?
      3. diff015_050 = Is (handwrittenValue of 015 - printedValue of 015) equal to handwrittenValue of 050?
      4. diff016_060 = Is (handwrittenValue of 016 - printedValue of 016) equal to handwrittenValue of 060?
      5. diff017_070 = Is (handwrittenValue of 017 - printedValue of 017) equal to handwrittenValue of 070?
      6. diff118_280 = Is (handwrittenValue of 118 - printedValue of 118) equal to handwrittenValue of 280?

      Return ONLY a JSON object matching this schema:
      {
        "basicInfo": {
          "customerName": string,
          "customerId": string,
          "peaMeterNo": string
        },
        "codes": {
          "111": { "printedValue": number, "handwrittenValue": number, "usage": number },
          ... other codes ...
        },
        "analysis": {
          "totalEnergyMatch": boolean,
          "sum010_020_030": number,
          "val111": number,
          "diff015_050": boolean,
          "diff016_060": boolean,
          "diff017_070": boolean,
          "diff118_280": boolean
        }
      }
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            { text: prompt },
            { inlineData: { mimeType: "image/jpeg", data: base64.split(',')[1] } }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json"
      }
    });

    try {
      return JSON.parse(response.text || '{}');
    } catch (e) {
      console.error("Failed to parse AI response", e);
      return null;
    }
  };

  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState<number | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const saveReading = async () => {
    console.log('Attempting to save reading:', formData);
    if (!formData.customer_name || !formData.customer_id || !formData.pea_meter_no) {
      alert('กรุณากรอกข้อมูลพื้นฐานให้ครบถ้วน (ชื่อ, ID, หมายเลขมิเตอร์)');
      return;
    }

    setIsSaving(true);
    try {
      const url = isEditing ? `/api/readings/${formData.id}` : '/api/readings';
      const method = isEditing ? 'PUT' : 'POST';
      
      // Exclude image_base64 from the data sent to the server as requested
      const { image_base64, ...dataToSave } = formData;
      
      const res = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataToSave)
      });
      
      if (res.ok) {
        const result = await res.json();
        console.log('Save successful:', result);
        alert(isEditing ? 'แก้ไขข้อมูลเรียบร้อยแล้ว' : 'บันทึกข้อมูลเรียบร้อยแล้ว');
        setIsEditing(false);
        setView('history');
        fetchReadings();
      } else {
        const errorData = await res.json();
        console.error('Save failed:', errorData);
        alert(`ไม่สามารถบันทึกข้อมูลได้: ${errorData.error || 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์'}`);
      }
    } catch (error) {
      console.error('Save error:', error);
      alert(`เกิดข้อผิดพลาดในการเชื่อมต่อ: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const downloadExcel = () => {
    if (readings.length === 0) {
      alert('ไม่มีข้อมูลสำหรับดาวน์โหลด');
      return;
    }

    const exportData = readings.map(r => ({
      'ชื่อผู้ใช้ไฟฟ้า': r.customer_name,
      'หมายเลขผู้ใช้ไฟฟ้า': r.customer_id,
      'หมายเลขมิเตอร์': r.pea_meter_no,
      'เดือน': MONTHS_TH[r.reading_month - 1],
      'ปี': r.reading_year,
      'On-Peak (010)': r.data.codes['010']?.handwrittenValue || 0,
      'Off-Peak (020)': r.data.codes['020']?.handwrittenValue || 0,
      'Holiday (030)': r.data.codes['030']?.handwrittenValue || 0,
      'รวม (111)': r.data.codes['111']?.handwrittenValue || 0,
      'สถานะการตรวจสอบ': r.data.analysis.totalEnergyMatch ? 'ถูกต้อง' : 'ไม่ถูกต้อง',
      'วันที่บันทึก': new Date(r.created_at!).toLocaleString('th-TH')
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(wb, `TOU_Report_${searchMonth || 'all'}_${searchYear || 'all'}.xlsx`);
  };

  const deleteReading = async (id: number) => {
    setIsDeleting(id);
    try {
      console.log(`Sending DELETE request for ID: ${id}`);
      const res = await fetch(`/api/readings/${id}`, { method: 'DELETE' });
      if (res.ok) {
        alert('ลบข้อมูลเรียบร้อยแล้ว');
        await fetchReadings();
      } else {
        const errorData = await res.json();
        console.error('Delete failed:', errorData);
        alert(`ลบข้อมูลไม่สำเร็จ: ${errorData.error || 'เกิดข้อผิดพลาด'}`);
      }
    } catch (error) {
      console.error('Delete error:', error);
      alert('เกิดข้อผิดพลาดในการเชื่อมต่อกับเซิร์ฟเวอร์');
    } finally {
      setIsDeleting(null);
      setDeleteConfirmId(null);
    }
  };

  const renderAnalysisCard = (title: string, isMatch: boolean, details?: string) => (
    <div className={`p-4 rounded-xl border ${isMatch ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'} flex items-start gap-3`}>
      {isMatch ? <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5" /> : <XCircle className="w-5 h-5 text-rose-600 mt-0.5" />}
      <div>
        <p className={`font-medium ${isMatch ? 'text-emerald-900' : 'text-rose-900'}`}>{title}</p>
        {details && <p className={`text-sm opacity-80 ${isMatch ? 'text-emerald-800' : 'text-rose-800'}`}>{details}</p>}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F5F5F5] text-slate-900 font-sans">
      {/* Sidebar / Navigation */}
      <nav className="fixed top-0 left-0 right-0 bg-white border-b border-slate-200 z-50 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => setView('home')}>
          <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center text-white">
            <FileText className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">TOU Meter Reader</h1>
            <p className="text-xs text-slate-500 font-medium">Expert Unit Reader</p>
          </div>
        </div>
        
        <div className="flex gap-2">
          <button 
            onClick={() => setView('scan')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${view === 'scan' ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100'}`}
          >
            <Camera className="w-4 h-4" />
            <span className="hidden sm:inline">อ่านหน่วย</span>
          </button>
          <button 
            onClick={() => setView('history')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${view === 'history' ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100'}`}
          >
            <History className="w-4 h-4" />
            <span className="hidden sm:inline">ประวัติ</span>
          </button>
          <button 
            onClick={() => setView('report')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${view === 'report' ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100'}`}
          >
            <FileText className="w-4 h-4" />
            <span className="hidden sm:inline">สรุปรายงาน</span>
          </button>
        </div>
      </nav>

      <main className="pt-20 pb-10 px-4 max-w-5xl mx-auto">
        <AnimatePresence mode="wait">
          {view === 'home' && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8 py-10"
            >
              <div className="text-center space-y-4">
                <h2 className="text-4xl font-bold tracking-tight text-slate-900">การอ่านหน่วยมิเตอร์ TOU</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div 
                  onClick={() => setView('scan')}
                  className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer group"
                >
                  <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600 mb-6 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                    <Camera className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">อ่านหน่วยจากรูปภาพ</h3>
                  <p className="text-slate-500 text-sm">อัปโหลดรูปใบอ่านหน่วยเพื่อสแกนข้อมูลอัตโนมัติ</p>
                </div>

                <div 
                  onClick={() => setView('history')}
                  className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer group"
                >
                  <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600 mb-6 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                    <History className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">ประวัติการอ่าน</h3>
                  <p className="text-slate-500 text-sm">ดูข้อมูลย้อนหลังและรายละเอียดการอ่านทั้งหมด</p>
                </div>

                <div 
                  onClick={() => setView('report')}
                  className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer group"
                >
                  <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600 mb-6 group-hover:bg-amber-600 group-hover:text-white transition-colors">
                    <FileText className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">สรุปรายงาน</h3>
                  <p className="text-slate-500 text-sm">สรุปข้อมูลการใช้ไฟฟ้าแยกตามรายชื่อและเดือน</p>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'scan' && (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">{isEditing ? 'แก้ไขข้อมูลการอ่านหน่วย' : 'อ่านหน่วย'}</h2>
                <div className="flex items-center gap-2">
                  {isEditing && (
                    <button 
                      onClick={saveReading}
                      disabled={isSaving}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-md shadow-indigo-100 disabled:opacity-50"
                    >
                      {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      บันทึกการแก้ไข
                    </button>
                  )}
                  <button 
                    onClick={() => {
                      setView('home');
                      setIsEditing(false);
                    }} 
                    className="text-slate-500 hover:text-slate-900 flex items-center gap-1 text-sm font-medium p-2"
                  >
                    <ArrowLeft className="w-4 h-4" /> กลับหน้าหลัก
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-100">
                  <h3 className="font-bold text-lg mb-4">1. ข้อมูลพื้นฐาน</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">ชื่อผู้ใช้ไฟฟ้า</label>
                      <input 
                        type="text" 
                        value={formData.customer_name}
                        onChange={e => setFormData({...formData, customer_name: e.target.value})}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        placeholder="ชื่อ-นามสกุล"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">หมายเลขผู้ใช้ไฟฟ้า</label>
                      <input 
                        type="text" 
                        value={formData.customer_id}
                        onChange={e => setFormData({...formData, customer_id: e.target.value})}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        placeholder="Customer ID"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">หมายเลขมิเตอร์ PEA</label>
                      <input 
                        type="text" 
                        value={formData.pea_meter_no}
                        onChange={e => setFormData({...formData, pea_meter_no: e.target.value})}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        placeholder="PEA Meter No."
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">รอบเดือน</label>
                      <select 
                        value={formData.reading_month}
                        onChange={e => setFormData({...formData, reading_month: parseInt(e.target.value)})}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      >
                        {MONTHS_TH.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">ปี (พ.ศ.)</label>
                      <input 
                        type="number" 
                        value={formData.reading_year}
                        onChange={e => setFormData({...formData, reading_year: parseInt(e.target.value)})}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      />
                    </div>
                  </div>
                </div>

                <div className="p-6 bg-slate-50/50">
                  <h3 className="font-bold text-lg mb-4">2. อัปโหลดรูปภาพใบอ่านหน่วย</h3>
                  <div className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-2xl p-10 bg-white hover:border-indigo-400 transition-colors cursor-pointer relative min-h-[200px]">
                    <input 
                      type="file" 
                      accept="image/*" 
                      onChange={handleFileUpload}
                      className="absolute inset-0 opacity-0 cursor-pointer z-10"
                    />
                    {loading ? (
                      <div className="flex flex-col items-center gap-3">
                        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
                        <p className="font-medium text-slate-600">กำลังประมวลผลรูปภาพด้วย AI...</p>
                      </div>
                    ) : formData.image_base64 ? (
                      <div className="flex flex-col items-center gap-4 w-full">
                        <div className="relative w-full max-w-md aspect-[3/4] rounded-lg overflow-hidden border border-slate-200 shadow-sm">
                          <img 
                            src={formData.image_base64} 
                            alt="Preview" 
                            className="w-full h-full object-contain bg-slate-50" 
                            referrerPolicy="no-referrer" 
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                            <div className="bg-white px-4 py-2 rounded-lg font-bold text-slate-900 flex items-center gap-2">
                              <Upload className="w-4 h-4" />
                              เปลี่ยนรูปภาพ
                            </div>
                          </div>
                        </div>
                        <p className="text-sm text-slate-500 font-medium">คลิกที่รูปเพื่อเปลี่ยนรูปภาพใหม่</p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <Upload className="w-10 h-10 text-slate-400" />
                        <div className="text-center">
                          <p className="font-bold text-slate-700">คลิกเพื่ออัปโหลด หรือลากไฟล์มาวาง</p>
                          <p className="text-sm text-slate-500">รองรับไฟล์ JPG, PNG (สูงสุด 10MB)</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {formData.data?.codes && Object.keys(formData.data.codes).length > 0 && (
                  <div className="p-6 space-y-8">
                    <div>
                      <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                        <Info className="w-5 h-5 text-indigo-600" />
                        ผลการวิเคราะห์ข้อมูล
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {renderAnalysisCard(
                          "ตรวจสอบยอดรวมพลังงาน (111)", 
                          formData.data.analysis.totalEnergyMatch,
                          `ผลรวม 010+020+030 = ${formData.data.analysis.sum010_020_030} (ค่า 111 = ${formData.data.analysis.val111})`
                        )}
                        {renderAnalysisCard("ตรวจสอบส่วนต่างรหัส 015 เทียบ 050", formData.data.analysis.diff015_050)}
                        {renderAnalysisCard("ตรวจสอบส่วนต่างรหัส 016 เทียบ 060", formData.data.analysis.diff016_060)}
                        {renderAnalysisCard("ตรวจสอบส่วนต่างรหัส 017 เทียบ 070", formData.data.analysis.diff017_070)}
                        {renderAnalysisCard("ตรวจสอบส่วนต่างรหัส 118 เทียบ 280", formData.data.analysis.diff118_280)}
                      </div>
                    </div>

                    <div>
                      <h3 className="font-bold text-lg mb-4">รายละเอียดข้อมูลหน่วย</h3>
                      <div className="overflow-x-auto rounded-xl border border-slate-200">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50 border-bottom border-slate-200">
                              <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">รหัส</th>
                              <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">ค่าที่พิมพ์มา</th>
                              <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">ค่าที่อ่านได้ (ลายมือ)</th>
                              <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">หน่วยที่ใช้</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {Object.entries(formData.data.codes).map(([code, data]: [string, any]) => (
                              <tr key={code} className="hover:bg-slate-50/50 transition-colors">
                                <td className="px-4 py-3 font-bold text-indigo-600">{code}</td>
                                <td className="px-4 py-3 text-right font-mono">{data.printedValue?.toLocaleString() ?? '0'}</td>
                                <td className="px-4 py-3 text-right font-mono text-indigo-700 font-bold">{data.handwrittenValue?.toLocaleString() ?? '0'}</td>
                                <td className="px-4 py-3 text-right font-mono text-emerald-600 font-bold">{data.usage?.toLocaleString() ?? '0'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="pt-6 border-t border-slate-100 flex justify-end gap-3">
                      <button 
                        onClick={() => setView('home')}
                        className="px-6 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition-all"
                      >
                        ยกเลิก
                      </button>
                      <button 
                        onClick={saveReading}
                        disabled={isSaving}
                        className={`px-8 py-2.5 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 transition-all flex items-center gap-2 ${isSaving ? 'opacity-70 cursor-not-allowed' : 'hover:bg-indigo-700'}`}
                      >
                        {isSaving ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <Save className="w-5 h-5" />
                        )}
                        {isSaving ? 'กำลังบันทึก...' : 'ยืนยันและบันทึกข้อมูล'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {view === 'history' && (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">ประวัติการอ่านหน่วย</h2>
                <div className="flex gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="ค้นหาชื่อ..." 
                      value={searchName}
                      onChange={e => setSearchName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && fetchReadings()}
                      className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none w-48 sm:w-64"
                    />
                  </div>
                  <button onClick={fetchReadings} className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                    <Search className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {readings.length === 0 ? (
                  <div className="bg-white p-20 rounded-2xl border border-slate-200 text-center space-y-4">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400">
                      <History className="w-8 h-8" />
                    </div>
                    <div>
                      <p className="font-bold text-slate-700">ไม่พบข้อมูลประวัติ</p>
                      <p className="text-sm text-slate-500">เริ่มอ่านหน่วยเพื่อบันทึกข้อมูลลงในระบบ</p>
                    </div>
                    <button onClick={() => setView('scan')} className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition-all">
                      อ่านหน่วย
                    </button>
                  </div>
                ) : (
                  readings.map((reading) => (
                    <div 
                      key={reading.id}
                      className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 group"
                    >
                      <div className="flex items-center gap-4 flex-1">
                        {reading.image_base64 ? (
                          <div className="w-16 h-16 rounded-lg overflow-hidden border border-slate-200 flex-shrink-0">
                            <img src={reading.image_base64} alt="Meter" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          </div>
                        ) : (
                          <div className={`w-16 h-16 rounded-xl flex items-center justify-center font-bold flex-shrink-0 ${reading.data.analysis.totalEnergyMatch ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                            {reading.data.analysis.totalEnergyMatch ? <CheckCircle2 className="w-8 h-8" /> : <XCircle className="w-8 h-8" />}
                          </div>
                        )}
                        <div className="min-w-0">
                          <h4 className="font-bold text-slate-900 truncate">{reading.customer_name}</h4>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-slate-500 mt-1">
                            <span>ID: {reading.customer_id}</span>
                            <span className="hidden sm:inline w-1 h-1 bg-slate-300 rounded-full"></span>
                            <span>Meter: {reading.pea_meter_no}</span>
                            <span className="hidden sm:inline w-1 h-1 bg-slate-300 rounded-full"></span>
                            <span className="text-indigo-600 font-bold">{MONTHS_TH[reading.reading_month - 1]} {reading.reading_year}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => {
                            setFormData(reading);
                            setIsEditing(true);
                            setView('scan');
                          }}
                          className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                          title="แก้ไข"
                        >
                          <Pencil className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={() => {
                            setSelectedReading(reading);
                            setView('detail');
                          }}
                          className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-bold hover:bg-slate-200 transition-all flex items-center gap-2"
                        >
                          ดูรายละเอียด
                          <ChevronRight className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setDeleteConfirmId(reading.id!)}
                          disabled={isDeleting === reading.id}
                          className={`p-2 rounded-lg transition-all ${isDeleting === reading.id ? 'text-slate-300' : 'text-rose-500 hover:bg-rose-50'}`}
                          title="ลบ"
                        >
                          {isDeleting === reading.id ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}

          {view === 'detail' && selectedReading && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button onClick={() => setView('history')} className="p-2 hover:bg-slate-100 rounded-lg transition-all">
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <h2 className="text-2xl font-bold">รายละเอียดการอ่านหน่วย</h2>
                </div>
                <div className="px-4 py-1.5 bg-indigo-100 text-indigo-700 rounded-full text-sm font-bold">
                  {MONTHS_TH[selectedReading.reading_month - 1]} {selectedReading.reading_year}
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-100 bg-slate-50/50 grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">ชื่อผู้ใช้ไฟฟ้า</label>
                    <p className="font-bold text-lg">{selectedReading.customer_name}</p>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">หมายเลขผู้ใช้ไฟฟ้า</label>
                    <p className="font-bold text-lg">{selectedReading.customer_id}</p>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">หมายเลขมิเตอร์ PEA</label>
                    <p className="font-bold text-lg">{selectedReading.pea_meter_no}</p>
                  </div>
                </div>

                <div className="p-6 space-y-8">
                  <div className="mb-6">
                    <h3 className="font-bold text-lg mb-4">รูปภาพใบอ่านหน่วย</h3>
                    {selectedReading.image_base64 ? (
                      <div className="rounded-xl border border-slate-200 overflow-hidden bg-slate-100 max-h-[500px] flex justify-center">
                        <img 
                          src={selectedReading.image_base64} 
                          alt="Meter Reading" 
                          className="max-w-full h-auto object-contain" 
                          referrerPolicy="no-referrer" 
                        />
                      </div>
                    ) : (
                      <div className="p-10 border-2 border-dashed border-slate-200 rounded-xl text-center text-slate-400 bg-slate-50">
                        <History className="w-10 h-10 mx-auto mb-2 opacity-20" />
                        <p>ไม่มีรูปภาพประกอบสำหรับรายการนี้</p>
                      </div>
                    )}
                  </div>
                  <div>
                    <h3 className="font-bold text-lg mb-4">ผลการตรวจสอบความถูกต้อง</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {renderAnalysisCard(
                        "ตรวจสอบยอดรวมพลังงาน (111)", 
                        selectedReading.data.analysis.totalEnergyMatch,
                        `ผลรวม 010+020+030 = ${selectedReading.data.analysis.sum010_020_030} (ค่า 111 = ${selectedReading.data.analysis.val111})`
                      )}
                      {renderAnalysisCard("ตรวจสอบส่วนต่างรหัส 015 เทียบ 050", selectedReading.data.analysis.diff015_050)}
                      {renderAnalysisCard("ตรวจสอบส่วนต่างรหัส 016 เทียบ 060", selectedReading.data.analysis.diff016_060)}
                      {renderAnalysisCard("ตรวจสอบส่วนต่างรหัส 017 เทียบ 070", selectedReading.data.analysis.diff017_070)}
                      {renderAnalysisCard("ตรวจสอบส่วนต่างรหัส 118 เทียบ 280", selectedReading.data.analysis.diff118_280)}
                    </div>
                  </div>

                  <div>
                    <h3 className="font-bold text-lg mb-4">ตารางข้อมูลหน่วย</h3>
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-bottom border-slate-200">
                            <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">รหัส</th>
                            <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">ค่าที่พิมพ์มา</th>
                            <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">ค่าที่อ่านได้ (ลายมือ)</th>
                            <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">หน่วยที่ใช้</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {Object.entries(selectedReading.data.codes).map(([code, data]: [string, any]) => (
                            <tr key={code} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-4 py-3 font-bold text-indigo-600">{code}</td>
                              <td className="px-4 py-3 text-right font-mono">{data.printedValue?.toLocaleString() ?? '0'}</td>
                              <td className="px-4 py-3 text-right font-mono text-indigo-700 font-bold">{data.handwrittenValue?.toLocaleString() ?? '0'}</td>
                              <td className="px-4 py-3 text-right font-mono text-emerald-600 font-bold">{data.usage?.toLocaleString() ?? '0'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'report' && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">สรุปรายงาน</h2>
                <div className="flex gap-2">
                  <select 
                    value={searchMonth}
                    onChange={e => setSearchMonth(e.target.value)}
                    className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    <option value="">ทุกเดือน</option>
                    {MONTHS_TH.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                  </select>
                  <input 
                    type="number" 
                    placeholder="ปี พ.ศ." 
                    value={searchYear}
                    onChange={e => setSearchYear(e.target.value)}
                    className="w-24 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                  <button onClick={fetchReadings} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-bold hover:bg-slate-200 transition-all">
                    ดึงข้อมูล
                  </button>
                  <button 
                    onClick={downloadExcel}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 transition-all flex items-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    ดาวน์โหลด Excel
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">ชื่อผู้ใช้ไฟฟ้า</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">เดือน/ปี</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">On-Peak (010)</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Off-Peak (020)</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Holiday (030)</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">รวม (111)</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">สถานะ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {readings.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-6 py-10 text-center text-slate-500 italic">ไม่พบข้อมูลรายงานสำหรับเงื่อนไขที่เลือก</td>
                        </tr>
                      ) : (
                        readings.map((r) => (
                          <tr key={r.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-6 py-4 font-bold text-slate-900">{r.customer_name}</td>
                            <td className="px-6 py-4 text-sm text-slate-600">{MONTHS_TH[r.reading_month - 1]} {r.reading_year}</td>
                            <td className="px-6 py-4 text-right font-mono">{r.data.codes['010']?.handwrittenValue?.toLocaleString() ?? '-'}</td>
                            <td className="px-6 py-4 text-right font-mono">{r.data.codes['020']?.handwrittenValue?.toLocaleString() ?? '-'}</td>
                            <td className="px-6 py-4 text-right font-mono">{r.data.codes['030']?.handwrittenValue?.toLocaleString() ?? '-'}</td>
                            <td className="px-6 py-4 text-right font-mono font-bold text-indigo-600">{r.data.codes['111']?.handwrittenValue?.toLocaleString() ?? '-'}</td>
                            <td className="px-6 py-4 text-center">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${r.data.analysis.totalEnergyMatch ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                {r.data.analysis.totalEnergyMatch ? 'ถูกต้อง' : 'ไม่ถูกต้อง'}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Delete Confirmation Modal */}
        <AnimatePresence>
          {deleteConfirmId !== null && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setDeleteConfirmId(null)}
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 overflow-hidden"
              >
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="w-16 h-16 bg-rose-100 rounded-full flex items-center justify-center text-rose-600">
                    <Trash2 className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">ยืนยันการลบข้อมูล?</h3>
                    <p className="text-slate-500 mt-2">คุณต้องการลบข้อมูลการอ่านหน่วยนี้ใช่หรือไม่? การดำเนินการนี้ไม่สามารถย้อนกลับได้</p>
                  </div>
                  <div className="flex gap-3 w-full pt-4">
                    <button 
                      onClick={() => setDeleteConfirmId(null)}
                      className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 transition-all"
                    >
                      ยกเลิก
                    </button>
                    <button 
                      onClick={() => deleteReading(deleteConfirmId)}
                      className="flex-1 px-4 py-3 bg-rose-600 text-white rounded-xl font-bold hover:bg-rose-700 transition-all shadow-lg shadow-rose-200"
                    >
                      ยืนยันการลบ
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
