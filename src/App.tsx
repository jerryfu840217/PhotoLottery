import React, { useState, useEffect, useRef, useMemo } from "react";
import axios from "axios";
import confetti from "canvas-confetti";
import { UploadCloud, Trash2, Gift, X, Image as ImageIcon, Edit2, Check, Plus, Users, Lock, Unlock, List, Download, LayoutGrid, Play, Pause, ChevronLeft, ChevronRight, MonitorPlay, Wind, Box, Zap, RotateCcw } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Sound Effects Setup
const playSpinSound = () => {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    let time = ctx.currentTime;
    for (let i = 0; i < 35; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = 600 + i * 5;
      
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.1, time + 0.01);
      gain.gain.linearRampToValueAtTime(0, time + 0.05);
      
      osc.start(time);
      osc.stop(time + 0.05);
      // Interval speeds up over 3 seconds originally, we just loop for about 3 seconds
      time += 0.12 - (i * 0.0025); 
    }
  } catch (e) {
    console.error("Audio error", e);
  }
};

const playWinSound = () => {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    
    const playNote = (freq: number, startTime: number, duration: number, type: OscillatorType = 'triangle') => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime + startTime);
      
      gain.gain.setValueAtTime(0, ctx.currentTime + startTime);
      gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + startTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + startTime + duration);
      
      osc.start(ctx.currentTime + startTime);
      osc.stop(ctx.currentTime + startTime + duration);
    };

    // Tada chord
    playNote(523.25, 0, 0.4); // C5
    playNote(659.25, 0, 0.4); // E5
    playNote(783.99, 0, 0.4); // G5
    playNote(1046.50, 0.2, 0.8); // C6
    playNote(783.99, 0.2, 0.8); // G5
    playNote(1318.51, 0.2, 0.8); // E6
  } catch (e) {
    console.error("Audio error", e);
  }
};

const compressImage = (file: File, maxWidth = 1080): Promise<File> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (blob) {
            resolve(new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", { type: 'image/jpeg' }));
          } else {
            resolve(file);
          }
        }, 'image/jpeg', 0.8);
      };
      img.onerror = () => resolve(file);
    };
    reader.onerror = () => resolve(file);
  });
};

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Photo = {
  id: number;
  filename: string;
  originalName: string;
  participantName?: string;
  uploaderId?: string;
  uploadTime: string;
};

export default function App() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [targetPhotos, setTargetPhotos] = useState<Photo[]>([]);
  const [isUploadingTarget, setIsUploadingTarget] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [showGrandDrawModal, setShowGrandDrawModal] = useState(false);
  const [prizeWinners, setPrizeWinners] = useState<{ 1: Photo | null, 2: Photo | null, 3: Photo | null }>({ 1: null, 2: null, 3: null });
  const [currentPrize, setCurrentPrize] = useState<1 | 2 | 3 | null>(null);
  const [isDrawingDialog, setIsDrawingDialog] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [tempWinner, setTempWinner] = useState<Photo | null>(null);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [participantName, setParticipantName] = useState("");
  const [editingPhotoId, setEditingPhotoId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [showParticipantsModal, setShowParticipantsModal] = useState(false);
  const [showAdminGallery, setShowAdminGallery] = useState(false);
  const [showSlideshow, setShowSlideshow] = useState(false);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [isPlayingSlideshow, setIsPlayingSlideshow] = useState(true);
  const [adminPassword, setAdminPassword] = useState("");
  const [confirmState, setConfirmState] = useState<{ isOpen: boolean; message: string; action: () => void }>({ isOpen: false, message: "", action: () => {} });
  const [alertState, setAlertState] = useState<{ isOpen: boolean; message: string }>({ isOpen: false, message: "" });
  const [visibleCount, setVisibleCount] = useState(20);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);

  const uniquePhotos = useMemo(() => {
    const map = new Map<string, Photo & { allNames: string[] }>();
    photos.forEach(photo => {
      if (!map.has(photo.filename)) {
        map.set(photo.filename, { ...photo, allNames: [] });
      }
      if (photo.participantName) {
        map.get(photo.filename)!.allNames.push(photo.participantName);
      }
    });
    return Array.from(map.values());
  }, [photos]);

  const showAlert = (message: string) => setAlertState({ isOpen: true, message });
  const confirmAction = (message: string, action: () => void) => setConfirmState({ isOpen: true, message, action });

  const [uploaderId] = useState(() => {
    let id = localStorage.getItem('uploaderId');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('uploaderId', id);
    }
    return id;
  });
  const [isAdmin, setIsAdmin] = useState(() => localStorage.getItem('isAdmin') === 'true');

  const getHeaders = () => {
    const headers: Record<string, string> = {
      'x-uploader-id': uploaderId
    };
    if (isAdmin) {
      headers['x-admin-password'] = '0000';
    }
    return headers;
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const targetFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchPhotos();
    fetchTargetPhotos();
    
    // Auto-refresh mechanism (poll every 5 seconds)
    const pollInterval = setInterval(() => {
      fetchPhotos();
    }, 5000);

    return () => clearInterval(pollInterval);
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (showSlideshow && isPlayingSlideshow && uniquePhotos.length > 0) {
      interval = setInterval(() => {
        setCurrentSlideIndex((prev) => (prev + 1) % uniquePhotos.length);
      }, 3000); // 3 seconds per slide
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [showSlideshow, isPlayingSlideshow, uniquePhotos.length]);

  const fetchTargetPhotos = async () => {
    try {
      const res = await axios.get("/api/target-photos");
      setTargetPhotos(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      console.error("Failed to fetch target photos", error);
      setTargetPhotos([]);
    }
  };

  const handleTargetUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      showAlert("File size exceeds 5MB limit.");
      return;
    }

    if (!["image/jpeg", "image/png"].includes(file.type)) {
      showAlert("Invalid file type. Only JPG and PNG are allowed.");
      return;
    }

    const formData = new FormData();
    
    setIsUploadingTarget(true);
    try {
      const compressedFile = await compressImage(file);
      formData.append("photo", compressedFile);

      await axios.post("/api/target-photos", formData, {
        headers: { 
          "Content-Type": "multipart/form-data",
          ...getHeaders()
        },
      });
      await fetchTargetPhotos();
    } catch (error: any) {
      console.error("Target upload failed", error);
      showAlert(error.response?.data?.error || "Upload failed");
    } finally {
      setIsUploadingTarget(false);
      if (targetFileInputRef.current) {
        targetFileInputRef.current.value = "";
      }
    }
  };

  const deleteTargetPhoto = (id: number) => {
    confirmAction("Are you sure you want to delete this target photo?", async () => {
      try {
        await axios.delete(`/api/target-photos/${id}`, { headers: getHeaders() });
        setTargetPhotos(prev => prev.filter(p => p.id !== id));
      } catch (error: any) {
        console.error("Failed to delete target photo", error);
        showAlert(error.response?.data?.error || "Failed to delete target photo");
      }
    });
  };

  const fetchPhotos = async () => {
    try {
      const res = await axios.get("/api/photos");
      setPhotos(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      console.error("Failed to fetch photos", error);
      setPhotos([]);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      showAlert("File size exceeds 5MB limit.");
      return;
    }

    if (!["image/jpeg", "image/png"].includes(file.type)) {
      showAlert("Invalid file type. Only JPG and PNG are allowed.");
      return;
    }

    setPendingFile(file);
    setPendingPreviewUrl(URL.createObjectURL(file));
  };

  const cancelUpload = () => {
    setPendingFile(null);
    if (pendingPreviewUrl) {
      URL.revokeObjectURL(pendingPreviewUrl);
      setPendingPreviewUrl(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const confirmUpload = async () => {
    if (!pendingFile || !participantName.trim()) return;

    // 檢查是否有特殊符號或空白 (只允許中英數字和換行)
    if (/[^\u4e00-\u9fa5a-zA-Z0-9\n\r]/.test(participantName)) {
      showAlert("名字不能包含空白或特殊符號，若有多人請務必使用「換行」輸入。請重新輸入！");
      return;
    }

    const formData = new FormData();

    setIsUploading(true);
    setUploadProgress(0);

    try {
      const compressedFile = await compressImage(pendingFile);
      formData.append("photo", compressedFile);
      formData.append("participantName", participantName.trim());

      await axios.post("/api/photos", formData, {
        headers: { 
          "Content-Type": "multipart/form-data",
          ...getHeaders()
        },
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percentCompleted = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total
            );
            setUploadProgress(percentCompleted);
          }
        },
      });
      await fetchPhotos();
    } catch (error: any) {
      console.error("Upload failed", error);
      showAlert(error.response?.data?.error || "Upload failed");
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      setParticipantName("");
      cancelUpload();
    }
  };

  const drawGrandPrize = async (prizeId: 1 | 2 | 3) => {
    if (photos.length === 0) {
      showAlert("目前沒有照片可以抽獎！");
      return;
    }

    setIsDrawingDialog(true);
    setIsSpinning(true);
    setCurrentPrize(prizeId);
    setTempWinner(null);
    playSpinSound();

    let currentIndex = 0;
    const interval = setInterval(() => {
      currentIndex = (currentIndex + 1) % photos.length;
      setCarouselIndex(currentIndex);
    }, 100);

    try {
      const res = await axios.post("/api/draw", {}, { headers: getHeaders() });
      const drawnWinner = res.data;

      setTimeout(() => {
        clearInterval(interval);
        playWinSound();
        
        const winnerIdx = photos.findIndex(p => p.id === drawnWinner.id);
        if (winnerIdx !== -1) setCarouselIndex(winnerIdx);

        triggerConfetti(prizeId === 1 ? 5 : prizeId === 2 ? 3 : 2);
        
        setTempWinner(drawnWinner);
        setIsSpinning(false);
      }, 3000);

    } catch (error: any) {
      console.error("Failed to draw winner", error);
      clearInterval(interval);
      setIsDrawingDialog(false);
      setIsSpinning(false);
      setCurrentPrize(null);
      const msg = error.response?.data?.error || "Failed to draw winner.";
      showAlert(msg);
    }
  };

  const confirmWinner = () => {
    if (currentPrize && tempWinner) {
      setPrizeWinners(prev => ({ ...prev, [currentPrize]: tempWinner }));
    }
    setIsDrawingDialog(false);
    setTempWinner(null);
    setCurrentPrize(null);
  };

  const resetDraws = () => {
    confirmAction("確定要重設並且清空所有中獎紀錄嗎？(照片將保留，但可以再次被抽出)", async () => {
      try {
        await axios.post("/api/draw/reset", {}, { headers: getHeaders() });
        setPrizeWinners({ 1: null, 2: null, 3: null });
        showAlert("抽獎紀錄已重設！");
      } catch (error) {
        showAlert("重設失敗！");
      }
    });
  };

  const triggerConfetti = (multiplier = 1) => {
    const duration = 3 * 1000 * multiplier;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 1000 };

    const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

    const interval: any = setInterval(function() {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        return clearInterval(interval);
      }

      const particleCount = 50 * (timeLeft / duration) * multiplier;
      confetti({
        ...defaults, particleCount,
        origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 }
      });
      confetti({
        ...defaults, particleCount,
        origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 }
      });
    }, 250);
  };

  const downloadPhoto = async (photo: Photo) => {
    try {
      const response = await fetch(`/uploads/${photo.filename}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${photo.participantName || 'photo'}_${photo.filename}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Failed to download photo", error);
      showAlert("Failed to download photo");
    }
  };

  const downloadAllPhotos = async () => {
    if (photos.length === 0) {
      showAlert("No photos to download");
      return;
    }
    
    showAlert("Starting download... This might take a moment depending on the number of photos.");
    
    // Simple sequential download to avoid overwhelming the browser
    for (const photo of photos) {
      await downloadPhoto(photo);
      // Small delay between downloads
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  };

  const clearPhotos = () => {
    confirmAction("Are you sure you want to delete all photos?", async () => {
      try {
        await axios.delete("/api/photos", { headers: getHeaders() });
        setPhotos([]);
      } catch (error: any) {
        console.error("Failed to clear photos", error);
        showAlert(error.response?.data?.error || "Failed to clear photos");
      }
    });
  };

  const deletePhoto = (id: number) => {
    confirmAction("Are you sure you want to delete this photo?", async () => {
      try {
        await axios.delete(`/api/photos/${id}`, { headers: getHeaders() });
        setPhotos(prev => prev.filter(p => p.id !== id));
      } catch (error: any) {
        console.error("Failed to delete photo", error);
        showAlert(error.response?.data?.error || "Failed to delete photo");
      }
    });
  };

  const startEditing = (photo: Photo) => {
    setEditingPhotoId(photo.id);
    setEditName(photo.participantName || photo.originalName);
  };

  const saveEdit = async (id: number) => {
    if (!editName.trim()) {
      showAlert("Name cannot be empty");
      return;
    }
    
    try {
      await axios.put(`/api/photos/${id}`, { participantName: editName.trim() }, { headers: getHeaders() });
      setPhotos(photos.map(p => p.id === id ? { ...p, participantName: editName.trim() } : p));
      setEditingPhotoId(null);
    } catch (error: any) {
      console.error("Failed to update photo", error);
      showAlert(error.response?.data?.error || "Failed to update photo");
    }
  };

  const cancelEdit = () => {
    setEditingPhotoId(null);
    setEditName("");
  };

  const toggleAdmin = () => {
    if (isAdmin) {
      setIsAdmin(false);
      localStorage.setItem('isAdmin', 'false');
    } else {
      setShowAdminModal(true);
    }
  };

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminPassword === "0000") {
      setIsAdmin(true);
      localStorage.setItem('isAdmin', 'true');
      setShowAdminModal(false);
      setAdminPassword("");
    } else {
      showAlert("Incorrect password");
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-col gap-3">
          <div className="flex items-center justify-center gap-2">
            <Gift className="w-6 h-6 text-indigo-600 flex-shrink-0" />
            <h1 className="text-xl font-semibold tracking-tight truncate">Jerry x Claire Wedding</h1>
          </div>
          <div className="flex items-center justify-between">
            <button 
              onClick={toggleAdmin}
              className="p-2 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors flex-shrink-0"
              title={isAdmin ? "Disable Admin Mode" : "Enable Admin Mode"}
            >
              {isAdmin ? <Unlock className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
            </button>
            <div className="flex items-center gap-1 sm:gap-3 flex-shrink-0">
              <button
                onClick={() => {
                  if (uniquePhotos.length > 0) {
                    setCurrentSlideIndex(0);
                    setIsPlayingSlideshow(true);
                    setShowSlideshow(true);
                  } else {
                    showAlert("目前還沒有照片可以輪播喔！");
                  }
                }}
                className="px-2 sm:px-3 py-1.5 text-sm font-medium text-zinc-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors flex items-center gap-1.5"
                title="輪播照片"
              >
                <MonitorPlay className="w-4 h-4" />
                <span className="hidden sm:inline">輪播照片</span>
              </button>
              <button
                onClick={() => setShowParticipantsModal(true)}
                className="px-2 sm:px-3 py-1.5 text-sm font-medium text-zinc-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors flex items-center gap-1.5"
                title="Participants"
              >
                <List className="w-4 h-4" />
                <span className="hidden sm:inline">Participants</span>
              </button>
              {isAdmin && (
                <>
                  <button
                    onClick={() => setShowAdminGallery(true)}
                    className="px-2 sm:px-3 py-1.5 text-sm font-medium text-zinc-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors flex items-center gap-1.5"
                    title="Admin Gallery"
                  >
                    <LayoutGrid className="w-4 h-4" />
                    <span className="hidden sm:inline">Admin Gallery</span>
                  </button>
                  <button
                    onClick={resetDraws}
                    disabled={photos.length === 0}
                    className="px-2 sm:px-3 py-1.5 text-sm font-medium text-zinc-600 hover:text-amber-600 hover:bg-amber-50 rounded-md transition-colors disabled:opacity-50 flex items-center gap-1.5"
                    title="重設抽獎"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span className="hidden sm:inline">Reset Draws</span>
                  </button>
                  <button
                    onClick={clearPhotos}
                    disabled={photos.length === 0 || isDrawing || isUploading}
                    className="px-2 sm:px-3 py-1.5 text-sm font-medium text-zinc-600 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50 flex items-center gap-1.5"
                    title="Clear All"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span className="hidden sm:inline">Clear All</span>
                  </button>
                </>
              )}
              {isAdmin && (
                <button
                  onClick={() => setShowGrandDrawModal(true)}
                  disabled={photos.length === 0 || isDrawing || isUploading}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Gift className="w-4 h-4" />
                  幸運抽獎
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        {/* Target Photos Section */}
        <section className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium flex items-center gap-2">
              <Users className="w-5 h-5 text-indigo-500" />
              尋找目標
            </h2>
            {isAdmin && (
              <div>
                <input
                  type="file"
                  ref={targetFileInputRef}
                  onChange={handleTargetUpload}
                  accept="image/jpeg, image/png"
                  className="hidden"
                  disabled={isUploadingTarget}
                />
                <button
                  onClick={() => targetFileInputRef.current?.click()}
                  disabled={isUploadingTarget}
                  className="px-3 py-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 text-sm font-medium rounded-md transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  {isUploadingTarget ? "Uploading..." : "Add Target"}
                </button>
              </div>
            )}
          </div>
          
          {targetPhotos.length === 0 ? (
            <div className="text-center py-8 bg-zinc-50 rounded-xl border border-zinc-200 border-dashed">
              <p className="text-zinc-500 text-sm">尚未設定尋找目標{isAdmin ? "，請點擊右上角新增" : ""}。</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {targetPhotos.map((photo) => (
                <div key={photo.id} className="group relative w-full aspect-square rounded-xl overflow-hidden bg-zinc-100 border border-zinc-200 shadow-sm">
                  <img
                    src={`/uploads/${photo.filename}`}
                    alt={photo.originalName}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  {isAdmin && (
                    <button
                      onClick={() => deleteTargetPhoto(photo.id)}
                      className="absolute top-2 right-2 p-1.5 bg-white/90 hover:bg-red-50 text-red-600 rounded-md shadow-sm backdrop-blur-sm opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all"
                      title="Delete Target"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Upload Section */}
        <section className="bg-white rounded-2xl border border-zinc-200 p-8 shadow-sm">
          <div className="max-w-xl mx-auto text-center">
            <h2 className="text-lg font-medium mb-2">找到他們 → 跟他們合照 → 上傳照片 → 輸入合照中所有人的名字</h2>
            <p className="text-sm text-zinc-500 mb-6">
                JPG or PNG up to 5MB. 
            </p>
            
            {pendingFile && pendingPreviewUrl ? (
              <div className="border border-zinc-200 rounded-xl p-6 bg-zinc-50 text-left">
                <h3 className="text-md font-medium mb-4 text-zinc-800">確認照片與輸入名單</h3>
                <div className="flex flex-col md:flex-row gap-6 items-start">
                  <div className="w-full md:w-1/2">
                    <img 
                      src={pendingPreviewUrl} 
                      alt="Preview" 
                      className="w-full h-auto rounded-lg shadow-sm border border-zinc-200 object-cover max-h-64"
                    />
                  </div>
                  <div className="w-full md:w-1/2 flex flex-col h-full justify-between">
                    <div className="mb-4">
                      <label htmlFor="participantName" className="block text-sm font-medium text-zinc-700 mb-1">
                        請輸入合照中所有人名單 (請輸入完整全名) <span className="text-red-500">*</span>
                      </label>
                      <div className="mb-2 p-2 bg-amber-50 border border-amber-200 rounded-md">
                        <p className="text-sm font-bold text-amber-700">⚠️ 若合照中不只一人，請務必「換行」輸入！</p>
                      </div>
                      <textarea
                        id="participantName"
                        value={participantName}
                        onChange={(e) => setParticipantName(e.target.value)}
                        placeholder="例如：&#10;傅宇祥&#10;黃薰樂"
                        rows={3}
                        className="w-full px-4 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all disabled:bg-zinc-100 disabled:text-zinc-500 resize-none"
                        disabled={isUploading}
                      />
                      <p className="text-xs text-zinc-500 mt-1">請避免重複輸入名字</p>
                    </div>
                    
                    {isUploading ? (
                      <div className="mt-2 space-y-2">
                        <div className="flex justify-between text-xs font-medium text-zinc-500">
                          <span>Uploading...</span>
                          <span>{uploadProgress}%</span>
                        </div>
                        <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-indigo-600 transition-all duration-300 ease-out rounded-full"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-3 mt-2">
                        <button
                          onClick={cancelUpload}
                          disabled={isUploading}
                          className="flex-1 px-4 py-2 border border-zinc-300 text-zinc-700 rounded-lg hover:bg-zinc-100 transition-colors text-sm font-medium disabled:opacity-50"
                        >
                          取消重選
                        </button>
                        <button
                          onClick={confirmUpload}
                          disabled={isUploading || !participantName.trim()}
                          className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          <UploadCloud className="w-4 h-4" />
                          確認上傳
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div 
                  className={cn(
                    "border-2 border-dashed rounded-xl p-8 transition-colors relative",
                    isUploading ? "border-indigo-300 bg-indigo-50/50" : "border-zinc-300 hover:border-indigo-400 hover:bg-zinc-50"
                  )}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    accept="image/jpeg, image/png"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                    disabled={isUploading || isDrawing}
                  />
                  <div className="flex flex-col items-center gap-3 pointer-events-none">
                    <div className="p-3 bg-white rounded-full shadow-sm border border-zinc-100">
                      <UploadCloud className="w-6 h-6 text-indigo-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-zinc-700">
                        Click or drag photo to upload
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        {/* Photo Grid */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-zinc-400" />
              Participants ({photos.length})
            </h2>
          </div>
          
          {photos.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-2xl border border-zinc-200 border-dashed">
              <p className="text-zinc-500 text-sm">No photos uploaded yet.</p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {photos.slice(0, visibleCount).map((photo) => (
                  <div key={photo.id} className="group relative aspect-square rounded-xl overflow-hidden bg-zinc-100 border border-zinc-200 shadow-sm">
                    <img
                      src={`/uploads/${photo.filename}`}
                      alt={photo.originalName}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      loading="lazy"
                    />
                  
                  {/* Actions Overlay */}
                  {(isAdmin || photo.uploaderId === uploaderId) && (
                    <div className="absolute top-2 right-2 flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity z-10">
                      <button
                        onClick={() => startEditing(photo)}
                        className="p-1.5 bg-white/90 hover:bg-white text-zinc-700 rounded-md shadow-sm backdrop-blur-sm transition-colors"
                        title="Edit Name"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deletePhoto(photo.id)}
                        className="p-1.5 bg-white/90 hover:bg-red-50 text-red-600 rounded-md shadow-sm backdrop-blur-sm transition-colors"
                        title="Delete Photo"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3 pt-8 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                    <p className="text-white text-xs truncate font-medium">
                      {photo.participantName || photo.originalName}
                    </p>
                  </div>

                  {/* Edit Overlay */}
                  {editingPhotoId === photo.id && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-20">
                      <div className="bg-white rounded-lg p-3 w-full shadow-xl">
                        <label className="block text-xs font-medium text-zinc-700 mb-1">Edit Name</label>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full px-2 py-1.5 text-sm border border-zinc-300 rounded focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none mb-2"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit(photo.id);
                            if (e.key === 'Escape') cancelEdit();
                          }}
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={cancelEdit}
                            className="p-1 text-zinc-500 hover:bg-zinc-100 rounded"
                          >
                            <X className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => saveEdit(photo.id)}
                            className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            
            {visibleCount < photos.length && (
              <div className="flex justify-center pt-4">
                <button
                  onClick={() => setVisibleCount(v => v + 20)}
                  className="px-6 py-2 bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700 font-medium rounded-full shadow-sm transition-colors"
                >
                  Load More ({photos.length - visibleCount} remaining)
                </button>
              </div>
            )}
          </div>
          )}
        </section>
      </main>

      {/* Participants Modal */}
      {showParticipantsModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-zinc-900/80 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-zinc-200 flex justify-between items-center bg-zinc-50">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Users className="w-5 h-5 text-indigo-600" />
                  Participant List
                </h3>
                <span className="px-2.5 py-0.5 bg-indigo-100 text-indigo-700 text-sm font-medium rounded-full">
                  Total: {new Set(photos.map(p => p.participantName || 'Unknown')).size}
                </span>
              </div>
              <button 
                onClick={() => setShowParticipantsModal(false)}
                className="p-1 text-zinc-400 hover:text-zinc-600 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <div className="space-y-3">
                {(() => {
                  const nameCounts = photos.reduce((acc, photo) => {
                    const name = photo.participantName || 'Unknown';
                    acc[name] = (acc[name] || 0) + 1;
                    return acc;
                  }, {} as Record<string, number>);

                  const sortedPhotos = [...photos].sort((a, b) => {
                    const nameA = a.participantName || 'Unknown';
                    const nameB = b.participantName || 'Unknown';
                    return nameA.localeCompare(nameB);
                  });

                  return sortedPhotos.map(photo => {
                    const name = photo.participantName || 'Unknown';
                    const isDuplicate = nameCounts[name] > 1;
                    const canDelete = isAdmin || photo.uploaderId === uploaderId;

                    return (
                      <div key={photo.id} className={cn("flex items-center justify-between p-3 rounded-xl border", isDuplicate ? "bg-red-50 border-red-200" : "bg-white border-zinc-200")}>
                        <div className="flex items-center gap-4">
                          <img src={`/uploads/${photo.filename}`} alt={name} className="w-12 h-12 rounded-lg object-cover border border-zinc-200" />
                          <div>
                            <p className={cn("font-medium", isDuplicate ? "text-red-700" : "text-zinc-900")}>
                              {name}
                              {isDuplicate && <span className="ml-2 text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">Duplicate</span>}
                            </p>
                            <p className="text-xs text-zinc-500">{new Date(photo.uploadTime).toLocaleString()}</p>
                          </div>
                        </div>
                        {canDelete && (
                          <button
                            onClick={() => deletePhoto(photo.id)}
                            className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Delete Photo"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    );
                  });
                })()}
                {photos.length === 0 && (
                  <p className="text-center text-zinc-500 py-8">No Participants yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Admin Gallery Modal */}
      {showAdminGallery && isAdmin && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-zinc-900/90 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-zinc-200 flex justify-between items-center bg-zinc-50">
              <div>
                <h3 className="text-xl font-semibold flex items-center gap-2">
                  <LayoutGrid className="w-6 h-6 text-indigo-600" />
                  Admin Photo Gallery
                </h3>
                <p className="text-sm text-zinc-500 mt-1">Total Photos: {photos.length}</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={downloadAllPhotos}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download All
                </button>
                <button 
                  onClick={() => setShowAdminGallery(false)}
                  className="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-full transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>
            <div className="p-6 overflow-y-auto flex-1 bg-zinc-50/50">
              {photos.length === 0 ? (
                <div className="text-center py-20">
                  <ImageIcon className="w-12 h-12 text-zinc-300 mx-auto mb-4" />
                  <p className="text-zinc-500 text-lg">No photos uploaded yet.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {photos.map((photo) => (
                    <div key={photo.id} className="group relative aspect-square rounded-xl overflow-hidden bg-white border border-zinc-200 shadow-sm">
                      <img
                        src={`/uploads/${photo.filename}`}
                        alt={photo.originalName}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        loading="lazy"
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 pt-12 opacity-0 group-hover:opacity-100 transition-opacity">
                        <p className="text-white text-sm font-medium truncate mb-2">
                          {photo.participantName || photo.originalName}
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => downloadPhoto(photo)}
                            className="flex-1 py-1.5 bg-white/20 hover:bg-white/30 text-white rounded backdrop-blur-sm transition-colors flex items-center justify-center gap-1 text-xs"
                          >
                            <Download className="w-3 h-3" />
                            Save
                          </button>
                          <button
                            onClick={() => deletePhoto(photo.id)}
                            className="p-1.5 bg-red-500/80 hover:bg-red-600 text-white rounded backdrop-blur-sm transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Admin Login Modal */}
      {showAdminModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-zinc-900/80 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">Admin Login</h3>
                <button 
                  onClick={() => {
                    setShowAdminModal(false);
                    setAdminPassword("");
                  }}
                  className="p-1 text-zinc-400 hover:text-zinc-600 rounded-full transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleAdminLogin}>
                <input
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="Enter admin password"
                  className="w-full px-4 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none mb-4"
                  autoFocus
                />
                <button
                  type="submit"
                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors"
                >
                  Login
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Modal */}
      {confirmState.isOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-zinc-900/80 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4">Confirm Action</h3>
              <p className="text-zinc-600 mb-6">{confirmState.message}</p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setConfirmState({ ...confirmState, isOpen: false })}
                  className="px-4 py-2 text-zinc-600 hover:bg-zinc-100 font-medium rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    confirmState.action();
                    setConfirmState({ ...confirmState, isOpen: false });
                  }}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Alert Modal */}
      {alertState.isOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-zinc-900/80 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4 text-zinc-800">溫馨提示</h3>
              <p className="text-zinc-600 mb-6 font-medium">{alertState.message}</p>
              <div className="flex justify-end">
                <button
                  onClick={() => setAlertState({ ...alertState, isOpen: false })}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors w-full"
                >
                  確認
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Grand Draw Modal */}
      {showGrandDrawModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-50 text-zinc-900 overflow-y-auto overflow-x-hidden animate-in fade-in duration-300">
          <button 
            onClick={() => setShowGrandDrawModal(false)}
            className="absolute top-4 right-4 md:top-6 md:right-6 z-20 p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200/50 rounded-full transition-colors"
          >
            <X className="w-8 h-8" />
          </button>

          <div className="w-full max-w-7xl mx-auto px-2 md:px-8 flex flex-col h-full min-h-screen pt-12 pb-4">
            <div className="text-center mb-8 shrink-0 relative z-10">
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-zinc-900 mb-2 drop-shadow-sm">
                Jerry x Claire photo lottery
              </h2>
            </div>

            <div className="flex-1 flex items-end justify-center gap-2 sm:gap-4 md:gap-8 pb-4 md:pb-8 relative z-10 w-full max-w-5xl mx-auto">
              
              {/* 2nd Prize */}
              <div className="flex flex-col items-center w-1/3">
                <div className="mb-2 md:mb-6 relative w-16 h-16 sm:w-24 sm:h-24 md:w-48 md:h-48 flex items-center justify-center">
                  <img 
                    src={prizeWinners[2] ? "/prizes/airfryer.png" : "/prizes/airfryer_grey.png"} 
                    alt="Air Fryer placeholder" 
                    className={cn(
                      "w-full h-full object-contain transition-all duration-1000", 
                      prizeWinners[2] ? "drop-shadow-2xl scale-110" : ""
                    )} 
                  />
                </div>
                <div className="w-full bg-slate-100 border-t-8 border-slate-300 rounded-t-2xl h-32 sm:h-40 md:h-56 flex flex-col items-center justify-start pt-3 sm:pt-4 md:pt-6 shadow-xl relative mt-auto pb-4">
                  <span className={cn("text-3xl sm:text-4xl md:text-5xl font-black text-black drop-shadow-sm transition-all duration-500", prizeWinners[2] ? "opacity-0 scale-75" : "opacity-100 scale-100")}>2nd</span>
                  
                  <div className="absolute inset-0 flex flex-col justify-end items-center w-full pb-3 sm:pb-5 md:pb-6">
                    {prizeWinners[2] ? (
                      <div className="flex flex-col items-center animate-in zoom-in-75 fade-in duration-500 absolute top-2 sm:top-2 md:top-4 w-full px-1">
                        <span className="text-[10px] sm:text-xs md:text-xl font-bold text-black mb-1 z-20 truncate w-full text-center">Electrolux氣炸鍋</span>
                        <img src={`/uploads/${prizeWinners[2].filename}`} className="w-14 h-14 sm:w-20 sm:h-20 md:w-32 md:h-32 rounded-full object-cover border-4 border-white shadow-lg z-20 bg-white mb-1.5 md:mb-2" />
                        <span className="text-[10px] sm:text-sm md:text-xl font-black text-black z-20 bg-white/80 px-2 sm:px-3 py-0.5 md:py-1 rounded-full backdrop-blur-md max-w-[95%] truncate shadow-sm border border-slate-200">{prizeWinners[2].participantName || prizeWinners[2].originalName}</span>
                      </div>
                    ) : (
                      <button 
                        onClick={() => drawGrandPrize(2)}
                        className="px-3 py-1.5 sm:px-6 sm:py-2 md:px-8 md:py-3 bg-indigo-500 hover:bg-indigo-400 text-white font-bold rounded-full text-[10px] sm:text-sm md:text-lg shadow-md transition-all hover:scale-105 z-10"
                      >
                        抽二獎
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* 1st Prize */}
              <div className="flex flex-col items-center w-[35%] z-10">
                <div className="mb-2 md:mb-6 relative w-20 h-20 sm:w-32 sm:h-32 md:w-64 md:h-64 flex items-center justify-center">
                  <img 
                    src={prizeWinners[1] ? "/prizes/dyson.png" : "/prizes/dyson_grey.png"} 
                    alt="Dyson placeholder" 
                    className={cn(
                      "w-full h-full object-contain transition-all duration-1000", 
                      prizeWinners[1] ? "drop-shadow-[0_0_30px_rgba(251,191,36,0.5)] scale-110" : ""
                    )} 
                  />
                </div>
                <div className="w-full bg-amber-50 border-t-8 border-amber-300 rounded-t-2xl h-40 sm:h-48 md:h-64 flex flex-col items-center justify-start pt-3 sm:pt-4 md:pt-6 shadow-2xl relative mt-auto pb-6">
                  <span className={cn("text-5xl sm:text-6xl md:text-7xl font-black text-black drop-shadow-sm transition-all duration-500", prizeWinners[1] ? "opacity-0 scale-75" : "opacity-100 scale-100")}>1st</span>
                  
                  <div className="absolute inset-0 flex flex-col justify-end items-center w-full pb-4 sm:pb-6 md:pb-8">
                    {prizeWinners[1] ? (
                      <div className="flex flex-col items-center animate-in zoom-in-75 fade-in duration-500 absolute top-2 sm:top-2 md:top-4 w-full px-2">
                        <span className="text-[10px] sm:text-sm md:text-2xl font-bold text-black mb-1 md:mb-2 z-20 truncate w-full text-center drop-shadow-sm">Dyson吹風機</span>
                        <img src={`/uploads/${prizeWinners[1].filename}`} className="w-16 h-16 sm:w-24 sm:h-24 md:w-36 md:h-36 rounded-full object-cover border-4 border-white shadow-xl z-20 bg-white mb-2 md:mb-3" />
                        <span className="text-xs sm:text-base md:text-2xl font-black text-black z-20 bg-white/80 px-2 sm:px-4 py-1 md:py-1.5 rounded-full backdrop-blur-md max-w-[95%] truncate shadow-sm border border-amber-200">{prizeWinners[1].participantName || prizeWinners[1].originalName}</span>
                      </div>
                    ) : (
                      <button 
                        onClick={() => drawGrandPrize(1)}
                        className="px-4 py-2 sm:px-8 sm:py-3 md:px-12 md:py-4 bg-amber-400 hover:bg-amber-300 text-amber-950 font-black rounded-full text-xs sm:text-base md:text-xl shadow-[0_0_20px_rgba(251,191,36,0.3)] transition-all hover:scale-105 z-10"
                      >
                        抽一獎
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* 3rd Prize */}
              <div className="flex flex-col items-center w-1/3">
                <div className="mb-2 md:mb-6 relative w-16 h-16 sm:w-24 sm:h-24 md:w-48 md:h-48 flex items-center justify-center">
                  <img 
                    src={prizeWinners[3] ? "/prizes/toothbrush.png" : "/prizes/toothbrush_grey.png"} 
                    alt="Toothbrush placeholder" 
                    className={cn(
                      "w-full h-full object-contain transition-all duration-1000", 
                      prizeWinners[3] ? "drop-shadow-2xl scale-110" : ""
                    )} 
                  />
                </div>
                <div className="w-full bg-orange-50/50 border-t-8 border-orange-200 rounded-t-2xl h-28 sm:h-36 md:h-48 flex flex-col items-center justify-start pt-3 sm:pt-4 md:pt-6 shadow-xl relative mt-auto pb-4">
                  <span className={cn("text-2xl sm:text-3xl md:text-4xl font-black text-black drop-shadow-sm transition-all duration-500", prizeWinners[3] ? "opacity-0 scale-75" : "opacity-100 scale-100")}>3rd</span>
                  
                  <div className="absolute inset-0 flex flex-col justify-end items-center w-full pb-2 sm:pb-4 md:pb-5">
                    {prizeWinners[3] ? (
                      <div className="flex flex-col items-center animate-in zoom-in-75 fade-in duration-500 absolute top-2 sm:top-2 md:top-4 w-full px-1">
                        <span className="text-[9px] sm:text-xs md:text-lg font-bold text-black mb-0.5 md:mb-1 z-20 truncate w-full text-center">Philips電動牙刷</span>
                        <img src={`/uploads/${prizeWinners[3].filename}`} className="w-12 h-12 sm:w-16 sm:h-16 md:w-28 md:h-28 rounded-full object-cover border-4 border-white shadow-md z-20 bg-white mb-1.5 md:mb-2" />
                        <span className="text-[9px] sm:text-xs md:text-lg font-black text-black z-20 bg-white/80 px-1.5 sm:px-2.5 py-0.5 md:py-1 rounded-full backdrop-blur-md max-w-[95%] truncate shadow-sm border border-orange-200">{prizeWinners[3].participantName || prizeWinners[3].originalName}</span>
                      </div>
                    ) : (
                      <button 
                        onClick={() => drawGrandPrize(3)}
                        className="px-2 py-1.5 sm:px-5 sm:py-2 md:px-6 md:py-2.5 bg-orange-400 hover:bg-orange-300 text-white font-bold rounded-full text-[10px] sm:text-sm md:text-base shadow-md transition-all hover:scale-105 z-10"
                      >
                        抽三獎
                      </button>
                    )}
                  </div>
                </div>
              </div>

            </div>
          </div>

          {/* Popup for spinning wheel */}
          {isDrawingDialog && (
            <div className="fixed inset-0 z-[110] flex flex-col items-center justify-center bg-zinc-900/60 backdrop-blur-md animate-in fade-in duration-200 p-4">
              <div className="w-full max-w-2xl bg-white rounded-3xl p-6 md:p-10 flex flex-col items-center shadow-2xl border border-zinc-200">
                <h3 className="text-2xl md:text-3xl font-bold text-zinc-800 mb-6 md:mb-8 text-center animate-pulse">
                  {isSpinning ? `正在抽出第 ${currentPrize} 獎...` : `第 ${currentPrize} 獎得主！`}
                </h3>
                
                <div className={cn("relative w-48 h-48 md:w-80 md:h-80 rounded-full overflow-hidden border-8 shadow-2xl mb-6 md:mb-8 transition-all duration-500", !isSpinning ? "border-amber-400 scale-105" : "border-indigo-100")}>
                  {photos.length > 0 && (
                    <img
                      src={`/uploads/${!isSpinning && tempWinner ? tempWinner.filename : photos[carouselIndex].filename}`}
                      alt="Current"
                      className={cn("w-full h-full object-cover transition-all", isSpinning ? "scale-110 blur-[1px] opacity-80" : "scale-100 blur-0 opacity-100")}
                    />
                  )}
                </div>

                {!isSpinning && tempWinner && (
                  <div className="text-center animate-in slide-in-from-bottom-8 fade-in duration-500 flex flex-col items-center w-full">
                    <span className="text-3xl md:text-4xl font-black text-zinc-800 mb-6 md:mb-8 block drop-shadow-sm truncate max-w-full px-4">{tempWinner.participantName || tempWinner.originalName}</span>
                    <button
                      onClick={confirmWinner}
                      className="px-8 py-3 md:px-12 md:py-4 bg-gradient-to-r from-amber-400 to-orange-400 hover:from-amber-400 hover:to-orange-400 text-white font-bold rounded-full text-lg md:text-xl shadow-xl transition-all hover:scale-105 flex items-center gap-2"
                    >
                      確定得獎
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {/* Slideshow Modal */}
      {showSlideshow && uniquePhotos.length > 0 && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-black/95 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="flex items-center justify-between p-4 text-white/70 absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-black/50 to-transparent">
            <div className="text-sm font-medium tracking-wider">
              {currentSlideIndex + 1} / {uniquePhotos.length}
            </div>
            <button
              onClick={() => setShowSlideshow(false)}
              className="p-2 hover:text-white hover:bg-white/10 rounded-full transition-colors"
              title="Close Slideshow"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          
          <div className="flex-1 relative flex items-center justify-center overflow-hidden p-4 sm:p-12">
            <img
              src={`/uploads/${uniquePhotos[currentSlideIndex].filename}`}
              alt={uniquePhotos[currentSlideIndex].allNames.join(", ") || "Slideshow image"}
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl animate-in fade-in zoom-in-95 duration-500"
              key={currentSlideIndex}
            />
            
            {/* Participant Name Overlay */}
            {uniquePhotos[currentSlideIndex].allNames.length > 0 && (
              <div className="absolute bottom-24 right-8 sm:right-12 bg-black/60 backdrop-blur-md text-white px-6 py-4 rounded-2xl text-xl font-medium shadow-xl animate-in slide-in-from-right-4 fade-in duration-500 whitespace-pre-wrap text-right">
                {uniquePhotos[currentSlideIndex].allNames.join("\n")}
              </div>
            )}
          </div>

          <div className="absolute bottom-0 left-0 right-0 p-6 flex items-center justify-center gap-6 bg-gradient-to-t from-black/80 to-transparent">
            <button
              onClick={() => {
                setIsPlayingSlideshow(false);
                setCurrentSlideIndex((prev) => (prev === 0 ? uniquePhotos.length - 1 : prev - 1));
              }}
              className="p-3 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors"
              title="Previous"
            >
              <ChevronLeft className="w-8 h-8" />
            </button>
            
            <button
              onClick={() => setIsPlayingSlideshow(!isPlayingSlideshow)}
              className="p-4 bg-white text-black hover:bg-zinc-200 rounded-full transition-transform hover:scale-105 active:scale-95 shadow-xl"
              title={isPlayingSlideshow ? "Pause" : "Play"}
            >
              {isPlayingSlideshow ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8 ml-1" />}
            </button>
            
            <button
              onClick={() => {
                setIsPlayingSlideshow(false);
                setCurrentSlideIndex((prev) => (prev + 1) % uniquePhotos.length);
              }}
              className="p-3 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors"
              title="Next"
            >
              <ChevronRight className="w-8 h-8" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

