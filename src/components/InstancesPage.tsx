import { useState, useEffect, useRef } from "react";
import { Plus, Box, Boxes, Save, Trash2, FolderOpen, Play, Settings, Search, X, Loader2, ArrowLeft, ArrowLeftRight, Image as ImageIcon, ChevronDown, CheckCircle, AlertCircle, FileCode2, HardDrive, Laptop, Star, Gamepad2, Flag, ArrowDownWideNarrow, SlidersHorizontal, List, LayoutGrid, Ellipsis, Pencil } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "./ToastProvider";
import { DeleteModal } from "./DeleteModal";
import { useTheme } from "../contexts/ThemeContext";
import { Tooltip } from "./Tooltip";
import { SidebarNavItem } from "./SidebarNavItem";
import clsx from "clsx";

export interface GameInstance {
  id: string;
  name: string;
  info: string;
  bottleName: string;
  executablePath: string;
  backgroundImage?: string;
  lastPlayed?: number;
  totalPlayTime?: number;
  playHistory?: Record<string, number>;
  runMode?: 'crossover' | 'parallels' | 'direct';
  gameFileStatus?: 'disk' | 'local';
  diskGameRoot?: string;
  localGameRoot?: string;
  gameRelativeDir?: string;
  commandArgs?: string;
  envVars?: string;
  workDir?: string;
  isStarred?: boolean;
  isPlaying?: boolean;
  isFinished?: boolean;
}

interface SearchResult {
  id: string;
  title: string;
  cover: string;
  source: string;
  url: string;
}

interface BatchItem {
  id: string;
  selected: boolean;
  dirName: string;
  executables: string[];
  selectedExec: string;
  runMode: 'crossover' | 'parallels' | 'direct';
  bottleName: string;
  status: 'pending' | 'matching' | 'matched' | 'unmatched';
  matchedResult: SearchResult | null;
  searchResults: SearchResult[];
  manualInfo: Partial<GameInstance>;
}

interface InstancesPageProps {
  instances: GameInstance[];
  setInstances: (instances: GameInstance[]) => void;
  onLaunch: (instance: GameInstance) => void;
  settingsTargetId?: string | null;
  onConsumeSettingsTarget?: () => void;
  focusInstanceId?: string | null;
  onConsumeFocusInstance?: () => void;
}

type ImportState = 'none' | 'choice' | 'search_params' | 'search_results' | 'manual_form';
type GameFileStatus = 'disk' | 'local';
type ViewMode = 'list' | 'grid';
type SortMode = 'recent' | 'name';

interface FilterState {
  crossover: boolean;
  parallels: boolean;
  direct: boolean;
  starred: boolean;
  playing: boolean;
  finished: boolean;
}

const EMPTY_FILTERS: FilterState = {
  crossover: false,
  parallels: false,
  direct: false,
  starred: false,
  playing: false,
  finished: false,
};

export function InstancesPage({ instances, setInstances, onLaunch, settingsTargetId, onConsumeSettingsTarget, focusInstanceId, onConsumeFocusInstance }: InstancesPageProps) {
  const { config, updateConfig } = useTheme();
  const { showToast } = useToast();
  
  const [bottles, setBottles] = useState<string[]>([]);
  const [pdVms, setPdVms] = useState<string[]>([]);
  const [scripts, setScripts] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  
  const [isImportMenuOpen, setIsImportMenuOpen] = useState(false);
  const [importState, setImportState] = useState<ImportState>('none');
  const [formData, setFormData] = useState<Partial<GameInstance>>({});
  
  const [searchExecPath, setSearchExecPath] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [isBatchMatching, setIsBatchMatching] = useState(false);
  const [editingBatchItemId, setEditingBatchItemId] = useState<string | null>(null);
  const [isGameFileStatusOpen, setIsGameFileStatusOpen] = useState(false);
  const [isMigratingGameFiles, setIsMigratingGameFiles] = useState(false);
  const cardsContainerRef = useRef<HTMLDivElement | null>(null);
  const importMenuRef = useRef<HTMLDivElement | null>(null);
  const formDataSnapshotRef = useRef<string>('');

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const [listSelectedId, setListSelectedId] = useState<string | null>(null);
  const [gridMenuId, setGridMenuId] = useState<string | null>(null);

  const [scriptModal, setScriptModal] = useState<{
    isOpen: boolean;
    targetId: string | null;
    view: 'select' | 'edit';
    isAccordionOpen: boolean;
    selectedScript: string;
    editName: string;
    editContent: string;
  }>({
    isOpen: false,
    targetId: null,
    view: 'select',
    isAccordionOpen: false,
    selectedScript: '',
    editName: '',
    editContent: ''
  });

  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; instance: GameInstance | null }>({
    isOpen: false,
    instance: null,
  });

  useEffect(() => {
    fetchContainers();
  }, [config.bottlesPath, config.pdPath]);

  useEffect(() => {
    if (!settingsTargetId) return;
    const target = instances.find(i => i.id === settingsTargetId);
    if (target) {
      const hydrated = {
        ...target,
        bottleName: target.bottleName || (target.runMode === 'parallels' ? (config.defaultPdVm || '') : (target.runMode === 'crossover' ? (effectiveDefaultBottle) : '')),
        diskGameRoot: target.diskGameRoot || config.defaultDiskGameRoot || '',
        localGameRoot: target.localGameRoot || config.defaultLocalGameRoot || '',
      };
      setFormData(hydrated);
      formDataSnapshotRef.current = JSON.stringify(hydrated);
      setSelectedId(target.id);
      setImportState('none');
      setIsGameFileStatusOpen(false);
    }
    if (onConsumeSettingsTarget) {
      onConsumeSettingsTarget();
    }
  }, [settingsTargetId, instances, onConsumeSettingsTarget, config.defaultDiskGameRoot, config.defaultLocalGameRoot]);

  useEffect(() => {
    if (!selectedId) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setSelectedId(null);
        setImportState('none');
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsImportMenuOpen(false);
        setIsSortMenuOpen(false);
        setIsFilterMenuOpen(false);
        setGridMenuId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!isImportMenuOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (importMenuRef.current && !importMenuRef.current.contains(e.target as Node)) {
        setIsImportMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [isImportMenuOpen]);

  const normalizePath = (path: string) => path.replace(/\/+$/, '');

  const getActiveGameRootByStatus = (inst: Partial<GameInstance>) => {
    if (inst.gameFileStatus === 'disk') return inst.diskGameRoot || '';
    if (inst.gameFileStatus === 'local') return inst.localGameRoot || '';
    return '';
  };

  const getStatusLabel = (status?: 'disk' | 'local') => {
    if (status === 'disk') return '硬盘';
    if (status === 'local') return '本机';
    return '未知';
  };

  const toSubPath = (childAbs: string, rootAbs: string) => {
    const rootNormalized = normalizePath(rootAbs.replace(/\\/g, '/'));
    const childNormalized = normalizePath(childAbs.replace(/\\/g, '/'));
    if (childNormalized === rootNormalized) return '';
    const rootPrefix = `${rootNormalized}/`;
    if (!childNormalized.startsWith(rootPrefix)) return null;
    return childNormalized.slice(rootPrefix.length);
  };

  const validateMigrationBase = (inst: Partial<GameInstance>) => {
    if (!inst.gameFileStatus) {
      return "需先设置当前游戏文件状态";
    }

    const execPath = (inst.executablePath || '').trim();
    if (!execPath) {
      return "需先设置好游戏文件状态与路径";
    }

    if (!inst.diskGameRoot || !inst.localGameRoot) {
      return "需先设置硬盘与本机游戏根目录";
    }

    if (!(inst.gameRelativeDir || '').trim()) {
      return "需先设置游戏文件相对目录";
    }

    return null;
  };

  const handleSelectRelativeDir = async () => {
    const currentStatus = formData.gameFileStatus;
    if (!currentStatus) {
      showToast("未设置当前游戏文件状态", "error");
      return;
    }

    const activeRoot = getActiveGameRootByStatus(formData);
    if (!activeRoot) {
      showToast("未设置当前状态对应的游戏根目录", "error");
      return;
    }

    try {
      const selected = await open({ directory: true, multiple: false, defaultPath: activeRoot });
      if (!selected || typeof selected !== 'string') return;

      const relative = toSubPath(selected, activeRoot);
      if (relative === null) {
        showToast("所选择的游戏目录并非游戏根目录的子目录", "error");
        return;
      }

      setFormData(prev => ({ ...prev, gameRelativeDir: relative }));
      showToast("已设置游戏文件相对目录", "success");
    } catch (e) {
      showToast(`选择目录失败: ${e}`, "error");
    }
  };

  const handleMigrateGameFiles = async () => {
    const instanceError = validateMigrationBase(formData);
    if (instanceError) {
      showToast(instanceError, "error");
      return;
    }

    if (!selectedId || !formData.gameFileStatus || !formData.diskGameRoot || !formData.localGameRoot || !formData.gameRelativeDir || !formData.executablePath) {
      showToast("当前实例信息不完整，无法迁移", "error");
      return;
    }

    const payloadSnapshot = {
      instanceId: selectedId,
      gameFileStatus: formData.gameFileStatus as GameFileStatus,
      diskGameRoot: formData.diskGameRoot,
      localGameRoot: formData.localGameRoot,
      gameRelativeDir: formData.gameRelativeDir,
      executablePath: formData.executablePath,
    };

    setIsMigratingGameFiles(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      const result = await invoke<{
        new_executable_path: string;
        new_status: GameFileStatus;
      }>("migrate_game_files", {
        payload: {
          instance_id: payloadSnapshot.instanceId,
          game_file_status: payloadSnapshot.gameFileStatus,
          disk_game_root: payloadSnapshot.diskGameRoot,
          local_game_root: payloadSnapshot.localGameRoot,
          game_relative_dir: payloadSnapshot.gameRelativeDir,
          executable_path: payloadSnapshot.executablePath,
        }
      });

      const updatedFormData: Partial<GameInstance> = {
        ...formData,
        executablePath: result.new_executable_path,
        gameFileStatus: result.new_status,
      };
      setFormData(updatedFormData);

      const runMode = updatedFormData.runMode || 'crossover';
      const newInstance = {
        ...updatedFormData,
        runMode,
        bottleName: updatedFormData.bottleName || (runMode === 'parallels' ? (config.defaultPdVm || '') : (runMode === 'crossover' ? (effectiveDefaultBottle) : ''))
      } as GameInstance;

      const newInstances = instances.find(i => i.id === newInstance.id)
        ? instances.map(i => i.id === newInstance.id ? newInstance : i)
        : [...instances, newInstance];

      setInstances(newInstances);
      setImportState('none');
      setSelectedId(null);
      showToast("游戏文件迁移成功，已自动保存", "success");
    } catch (e) {
      showToast(`${e}`, "error");
    } finally {
      setIsMigratingGameFiles(false);
    }
  };

  const fetchContainers = async () => {
    try {
      const res = await invoke<string[]>("get_crossover_bottles", { path: config.bottlesPath });
      const validBottles = res.length > 0 ? res : ["Default"];
      setBottles(validBottles);
      if (!validBottles.includes(config.defaultBottle)) {
        updateConfig({ defaultBottle: validBottles[0] });
      }
    } catch (e) { setBottles(["Default"]); }
    
    try {
      // @ts-ignore
      const res = await invoke<string[]>("get_pd_vms", { path: config.pdPath || '~/Applications (Parallels)' });
      setPdVms(res.length > 0 ? res : []);
    } catch (e) { setPdVms([]); }

    try {
      const res = await invoke<string[]>("get_scripts");
      setScripts(res || []);
    } catch (e) { setScripts([]); }
  };

  const effectiveDefaultBottle = bottles.includes(config.defaultBottle) ? config.defaultBottle : (bottles[0] || 'Default');

  const handleOpenScriptModal = (targetId: string | null, currentScript: string) => {
    setScriptModal(prev => ({
      ...prev,
      isOpen: true,
      targetId,
      view: 'select',
      isAccordionOpen: false,
      selectedScript: currentScript && currentScript !== 'Default' ? currentScript : '',
      editName: '',
      editContent: ''
    }));
  };

  const handleEditScript = async () => {
    if (scriptModal.selectedScript) {
      try {
        const content = await invoke<string>('read_script', { name: scriptModal.selectedScript });
        setScriptModal(prev => ({ ...prev, view: 'edit', editName: prev.selectedScript, editContent: content }));
      } catch (e) { showToast(`读取失败: ${e}`, "error"); }
    } else {
      setScriptModal(prev => ({ ...prev, view: 'edit', editName: '', editContent: '' }));
    }
  };

  const handleSaveScript = async () => {
    if (!scriptModal.editName.trim()) {
      showToast("请补全脚本名称", "error");
      return;
    }
    try {
      await invoke('save_script', { name: scriptModal.editName.trim(), content: scriptModal.editContent });
      await fetchContainers();
      setScriptModal(prev => ({
        ...prev,
        view: 'select',
        selectedScript: prev.editName.trim()
      }));
    } catch (e) {
      showToast(`保存失败: ${e}`, "error");
    }
  };

  const handleConfirmScript = () => {
    const finalVal = scriptModal.selectedScript;
    if (scriptModal.targetId) {
      updateBatchItem(scriptModal.targetId, { bottleName: finalVal });
    } else {
      setFormData({ ...formData, bottleName: finalVal });
    }
    setScriptModal(prev => ({ ...prev, isOpen: false }));
  };

  const fetchGameResults = async (keywords: string[]): Promise<SearchResult[]> => {
    let allResults: SearchResult[] = [];
    const promises = keywords.flatMap(kw => [
      invoke<SearchResult[]>('search_game', { keyword: kw, source: 'touchgal' }).catch(() => []),
      invoke<SearchResult[]>('search_game', { keyword: kw, source: 'kungal' }).catch(() => [])
    ]);
    const resultsArrays = await Promise.all(promises);
    resultsArrays.forEach(arr => allResults.push(...arr));
    
    const uniqueMap = new Map();
    allResults.forEach(item => { uniqueMap.set(item.title + item.source, item); });
    return Array.from(uniqueMap.values());
  };

  const handleSearchGame = async () => {
    if (!searchExecPath) return;
    setIsSearching(true);
    try {
      const keywords = await invoke<string[]>('get_directory_keywords', { path: searchExecPath });
      if (keywords.length === 0) {
        showToast("未提取到有效关键字", "error");
        setIsSearching(false);
        return;
      }
      const uniqueResults = await fetchGameResults(keywords);
      setSearchResults(uniqueResults);
      setImportState('search_results');
    } catch (error) {
      console.error(error);
      showToast("检索失败，请检查网络", "error");
    } finally {
      setIsSearching(false);
    }
  };

  const handleSave = () => {
    if (!formData.name || !formData.executablePath) {
      showToast("名称和可执行文件路径不能为空", "error");
      return;
    }
    const runMode = formData.runMode || 'crossover';
    const newInstance = {
      ...formData,
      runMode,
      bottleName: formData.bottleName || (runMode === 'parallels' ? (config.defaultPdVm || '') : (runMode === 'crossover' ? (effectiveDefaultBottle) : ''))
    } as GameInstance;

    let newInstances = instances.find(i => i.id === newInstance.id) 
      ? instances.map(i => i.id === newInstance.id ? newInstance : i)
      : [...instances, newInstance];
      
    setInstances(newInstances);
    showToast("保存成功", "success");
    setImportState('none');
    setSelectedId(null);
  };

  const handleDelete = () => {
    if (!deleteModal.instance) return;
    setInstances(instances.filter(i => i.id !== deleteModal.instance!.id));
    setDeleteModal({ isOpen: false, instance: null });
    setSelectedId(null);
    setImportState('none');
    showToast("实例已删除", "success");
  };

  const handleBatchImportClick = async () => {
    setIsImportMenuOpen(false);
    const selected = await open({ directory: true });
    if (selected && typeof selected === 'string') {
      try {
        const dirs = await invoke<{ dir_name: string, executables: string[] }[]>('scan_game_directories', { path: selected });
        if (dirs.length === 0) {
          showToast("未在此目录下找到任何包含可执行文件的游戏", "error");
          return;
        }
        const items: BatchItem[] = dirs.map(d => ({
          id: crypto.randomUUID(),
          selected: true,
          dirName: d.dir_name,
          executables: d.executables,
          selectedExec: d.executables[0],
          runMode: 'crossover',
          bottleName: effectiveDefaultBottle,
          status: 'pending',
          matchedResult: null,
          searchResults: [],
          manualInfo: {}
        }));
        setBatchItems(items);
        setIsBatchModalOpen(true);
      } catch (e) {
        showToast("扫描目录失败", "error");
      }
    }
  };

  const updateBatchItem = (id: string, updates: Partial<BatchItem>) => {
    setBatchItems(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  };

  const isAllSelected = batchItems.length > 0 && batchItems.every(i => i.selected);
  const toggleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setBatchItems(prev => prev.map(item => ({ ...item, selected: checked })));
  };

  const handleStartBatchMatching = async () => {
    setIsBatchMatching(true);
    const itemsToMatch = batchItems.filter(i => i.selected && (i.status === 'pending' || i.status === 'unmatched'));
    setBatchItems(prev => prev.map(item => itemsToMatch.find(i => i.id === item.id) ? { ...item, status: 'matching' } : item));

    for (const item of itemsToMatch) {
      try {
        const keywords = await invoke<string[]>('get_directory_keywords', { path: item.selectedExec });
        if (keywords.length === 0) {
          updateBatchItem(item.id, { status: 'unmatched', searchResults: [] });
          continue;
        }
        const results = await fetchGameResults(keywords);
        if (results.length > 0) {
          updateBatchItem(item.id, { status: 'matched', matchedResult: results[0], searchResults: results });
        } else {
          updateBatchItem(item.id, { status: 'unmatched', searchResults: [] });
        }
      } catch (e) {
        updateBatchItem(item.id, { status: 'unmatched', searchResults: [] });
      }
    }
    setIsBatchMatching(false);
  };

  const handleConfirmBatchImport = () => {
    const toImport = batchItems.filter(i => i.selected);
    if (toImport.length === 0) {
      showToast("请至少选择一个要导入的游戏", "error");
      return;
    }
    const newInstances: GameInstance[] = toImport.map(item => {
      const finalName = item.manualInfo.name || item.matchedResult?.title || item.dirName;
      const finalCover = item.manualInfo.backgroundImage || item.matchedResult?.cover;
      return {
        id: crypto.randomUUID(),
        name: finalName,
        runMode: item.runMode,
        bottleName: item.bottleName,
        executablePath: item.selectedExec,
        info: item.manualInfo.info || '',
        backgroundImage: finalCover,
      };
    });
    setInstances([...instances, ...newInstances]);
    setIsBatchModalOpen(false);
    setBatchItems([]);
    showToast(`成功批量导入 ${newInstances.length} 个游戏`, "success");
  };

  const DropdownArrow = () => (
    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-50">
      <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );

  const isEditing = selectedId !== null || importState === 'manual_form';

  useEffect(() => {
    if (!selectedId && importState !== 'manual_form') return;
    setFormData(prev => {
      const runMode = prev.runMode || 'crossover';
      return {
        ...prev,
        bottleName: prev.bottleName || (runMode === 'parallels' ? (config.defaultPdVm || '') : (runMode === 'crossover' ? (effectiveDefaultBottle) : '')),
        diskGameRoot: prev.diskGameRoot || config.defaultDiskGameRoot || '',
        localGameRoot: prev.localGameRoot || config.defaultLocalGameRoot || '',
      };
    });
  }, [selectedId, importState, config.defaultDiskGameRoot, config.defaultLocalGameRoot, config.defaultBottle, config.defaultPdVm, effectiveDefaultBottle]);

  // 实例详情页自动保存：任何修改（表单字段 / 顶部标识）实时写入 instances.json
  useEffect(() => {
    if (!selectedId) return;
    const snapshot = JSON.stringify(formData);
    if (snapshot === formDataSnapshotRef.current) return;
    formDataSnapshotRef.current = snapshot;

    const runMode = formData.runMode || 'crossover';
    const updated: GameInstance = {
      ...formData,
      id: selectedId,
      runMode,
      bottleName: formData.bottleName || (runMode === 'parallels' ? (config.defaultPdVm || '') : (runMode === 'crossover' ? (effectiveDefaultBottle) : ''))
    } as GameInstance;

    const newInstances = instances.map(i => (i.id === selectedId ? updated : i));
    setInstances(newInstances);
  }, [formData, selectedId]);

  useEffect(() => {
    if (!focusInstanceId || isEditing) return;
    const container = cardsContainerRef.current;
    if (!container) {
      if (onConsumeFocusInstance) onConsumeFocusInstance();
      return;
    }

    const target = container.querySelector<HTMLElement>(`[data-instance-id="${focusInstanceId}"]`);
    if (target) {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    if (onConsumeFocusInstance) onConsumeFocusInstance();
  }, [focusInstanceId, isEditing, onConsumeFocusInstance, instances]);

  // ===== 新增：筛选与排序逻辑 =====
  const modeFilterActive = filters.crossover || filters.parallels || filters.direct;

  const filteredSorted = (() => {
    const filtered = instances.filter(inst => {
      if (modeFilterActive) {
        const mode = inst.runMode || 'crossover';
        const matchMode = (filters.crossover && mode === 'crossover') || (filters.parallels && mode === 'parallels') || (filters.direct && mode === 'direct');
        if (!matchMode) return false;
      }
      if (filters.starred && !inst.isStarred) return false;
      if (filters.playing && !inst.isPlaying) return false;
      if (filters.finished && !inst.isFinished) return false;
      return true;
    });

    if (sortMode === 'name') {
      return filtered.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    }
    return filtered.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || b.id.localeCompare(a.id));
  })();

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const effectiveListSelection = instances.find(i => i.id === listSelectedId) || filteredSorted[0] || null;

  // ===== 新增：各操作处理函数 =====
  const openDetail = (inst: GameInstance) => {
    const hydrated = {
      ...inst,
      bottleName: inst.bottleName || (inst.runMode === 'parallels' ? (config.defaultPdVm || '') : (inst.runMode === 'crossover' ? (effectiveDefaultBottle) : '')),
      diskGameRoot: inst.diskGameRoot || config.defaultDiskGameRoot || '',
      localGameRoot: inst.localGameRoot || config.defaultLocalGameRoot || '',
    };
    setFormData(hydrated);
    formDataSnapshotRef.current = JSON.stringify(hydrated);
    setSelectedId(inst.id);
    setGridMenuId(null);
    setIsSortMenuOpen(false);
    setIsFilterMenuOpen(false);
  };

  const handleGoBack = () => {
    setSelectedId(null);
    setImportState('none');
    setGridMenuId(null);
  };

  const handleSingleImport = () => {
    setIsImportMenuOpen(false);
    setSelectedId(null);
    setGridMenuId(null);
    setFormData({ runMode: 'crossover', bottleName: effectiveDefaultBottle });
    setImportState('choice');
  };

  const handleOpenExecutableFolder = async (execPath: string) => {
    if (!execPath || !execPath.trim()) {
      showToast("尚未设置可执行文件路径", "error");
      return;
    }
    try {
      await revealItemInDir(execPath);
    } catch (e) {
      showToast(`无法打开文件夹: ${e}`, "error");
    }
  };

  const handleLaunchSelected = () => {
    if (instances.length === 0) {
      showToast("请先创建至少一个实例", "error");
      return;
    }
    const target = effectiveListSelection || instances[0];
    if (target) {
      onLaunch(target);
    }
  };

  const handleLaunchCurrentDetail = () => {
    if (!selectedId) return;
    const inst = instances.find(i => i.id === selectedId);
    if (!inst) return;
    onLaunch({ ...inst, ...formData, id: selectedId } as GameInstance);
  };

  const toggleBadge = (field: 'isStarred' | 'isPlaying' | 'isFinished') => {
    setFormData(prev => ({ ...prev, [field]: !prev[field] }));
  };

  const getSidebarIcon = (inst: GameInstance) => {
    if (inst.isStarred) return <Star size={16} className="text-yellow-400" fill="currentColor" />;
    if (inst.isPlaying) return <Gamepad2 size={16} className="text-green-500" />;
    if (inst.isFinished) return <Flag size={16} className="text-blue-500" fill="currentColor" />;
    return <Box size={16} className="opacity-60" />;
  };

  const getRunModeLabel = (inst: GameInstance) => {
    const mode = inst.runMode || 'crossover';
    const label = mode === 'parallels' ? 'Parallels' : (mode === 'direct' ? 'Direct' : 'CrossOver');
    const value = inst.bottleName || (mode === 'direct' ? '无前置' : '');
    return `${label}: ${value}`;
  };

  return (
    <div className="h-full flex relative">
      {/* ===== 左侧侧边栏 ===== */}
      <aside className="w-1/4 min-w-[220px] max-w-[320px] flex flex-col shrink-0 border-r border-black/10 dark:border-white/10 rounded-2xl overflow-hidden my-3 ml-3">
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1">
          <SidebarNavItem
            active={!isEditing}
            icon={<Boxes size={18} className="text-indigo-500 shrink-0" />}
            label="全部实例"
            onClick={handleGoBack}
          >
            {!isEditing && <span className="ml-auto text-xs px-1.5 py-0.5 rounded-full bg-black/5 dark:bg-white/10 text-gray-500 dark:text-white/50 shrink-0">{instances.length}</span>}
          </SidebarNavItem>

          <div className="h-px bg-black/10 dark:bg-white/10 mx-2" />

          {instances.map(inst => (
            <SidebarNavItem
              key={inst.id}
              active={selectedId === inst.id}
              icon={<span className="shrink-0">{getSidebarIcon(inst)}</span>}
              label={inst.name}
              onClick={() => openDetail(inst)}
            />
          ))}
        </div>

        {/* 底部导入按钮 */}
        <div className="p-3 border-t border-black/10 dark:border-white/10">
          <div className="relative" ref={importMenuRef}>
            <button
              onClick={() => { setIsImportMenuOpen(!isImportMenuOpen); }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-all shadow-md hover:shadow-blue-500/30 active:scale-95"
            >
              <Plus size={16} /> 导入实例 <ChevronDown size={14} className={clsx("transition-transform duration-200", isImportMenuOpen && "rotate-180")} />
            </button>
            <AnimatePresence>
              {isImportMenuOpen && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute bottom-full left-0 right-0 mb-2 bg-white dark:bg-[#252525] border border-black/10 dark:border-white/10 rounded-lg shadow-xl z-40 overflow-hidden">
                  <button onClick={handleSingleImport} className="w-full text-left px-4 py-3 text-sm hover:bg-black/5 dark:hover:bg-white/5 transition-colors font-medium">单个导入</button>
                  <button onClick={handleBatchImportClick} className="w-full text-left px-4 py-3 text-sm hover:bg-black/5 dark:hover:bg-white/5 transition-colors font-medium border-t border-black/5 dark:border-white/5">批量导入</button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </aside>

      {/* ===== 右侧主内容区域 ===== */}
      <main className="flex-1 h-full min-w-0 relative flex flex-col">
        {isEditing ? (
          /* ---------- 详情设置界面 ---------- */
          <div className="flex-1 overflow-y-auto p-8 relative w-full custom-scrollbar">
            <div className="max-w-3xl mx-auto">
              {selectedId ? (
                <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <h2 className="text-2xl font-bold truncate">{formData.name || '未命名实例'}</h2>
                    <div className="flex items-center gap-1 shrink-0">
                      <BadgeToggleBtn active={!!formData.isStarred} activeClass="text-yellow-400" onClick={() => toggleBadge('isStarred')} title="星标">
                        <Star size={20} fill={formData.isStarred ? 'currentColor' : 'none'} />
                      </BadgeToggleBtn>
                      <BadgeToggleBtn active={!!formData.isPlaying} activeClass="text-green-500" onClick={() => toggleBadge('isPlaying')} title="正在游玩">
                        <Gamepad2 size={20} />
                      </BadgeToggleBtn>
                      <BadgeToggleBtn active={!!formData.isFinished} activeClass="text-blue-500" onClick={() => toggleBadge('isFinished')} title="已通关">
                        <Flag size={20} fill={formData.isFinished ? 'currentColor' : 'none'} />
                      </BadgeToggleBtn>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <IconBtn title="打开文件夹" onClick={() => handleOpenExecutableFolder(formData.executablePath || '')}>
                      <FolderOpen size={18} />
                    </IconBtn>
                    <IconBtn title="删除实例" onClick={() => setDeleteModal({ isOpen: true, instance: instances.find(i => i.id === selectedId)! })}>
                      <Trash2 size={18} className="text-red-500" />
                    </IconBtn>
                    <button onClick={handleLaunchCurrentDetail} className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2 shadow-lg shadow-blue-500/30">
                      <Play size={16} /> 启动实例
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold">配置实例信息</h2>
                </div>
              )}

              <div className="space-y-6">
                {selectedId && (
                  <div className="flex justify-end">
                    <div className="px-3 py-1.5 rounded-lg text-sm border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5">
                      游戏文件状态：{getStatusLabel(formData.gameFileStatus)}
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium mb-2">封面链接 (Banner URL)</label>
                  <div className="relative aspect-[21/9] w-full bg-black/5 dark:bg-white/5 rounded-xl border border-black/10 dark:border-white/10 overflow-hidden group">
                    {/* 兼容用户手动输入本地路径的情况 */}
                    {formData.backgroundImage ? (
                      <img src={formData.backgroundImage.startsWith('/') ? convertFileSrc(formData.backgroundImage) : formData.backgroundImage} className="w-full h-full object-cover" alt="Banner" />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
                        <ImageIcon size={48} className="mb-2 opacity-50" />
                        <span>暂无封面</span>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 mt-3">
                    <input 
                      type="text" 
                      placeholder="可粘贴图片 URL 或本地路径..." 
                      value={formData.backgroundImage || ''} 
                      onChange={e => setFormData({ ...formData, backgroundImage: e.target.value })} 
                      className="flex-1 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-4 py-2 outline-none" 
                    />
                    <Tooltip label="选择本地图片">
                      <button 
                        onClick={async () => {
                          const res = await open({ filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
                          if (res && typeof res === 'string') {
                            // 选中后直接转换为 asset:// 安全协议保存
                            setFormData({ ...formData, backgroundImage: convertFileSrc(res) });
                          }
                        }} 
                        className="px-4 py-2 bg-black/5 dark:bg-white/10 rounded-lg hover:bg-black/10 dark:hover:bg-white/20 transition-colors"
                      >
                        <FolderOpen size={20} />
                      </button>
                    </Tooltip>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">实例名称</label>
                  <input value={formData.name || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-4 py-2 outline-none" />
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="min-w-0">
                    <label className="block text-sm font-medium mb-2 truncate">运行方式</label>
                    <div className="relative">
                      <select 
                        value={formData.runMode || 'crossover'} 
                        onChange={e => {
                          const mode = e.target.value as 'crossover' | 'parallels' | 'direct';
                          setFormData({ 
                            ...formData, 
                            runMode: mode,
                            bottleName: mode === 'parallels' ? (config.defaultPdVm || pdVms[0] || '') : (mode === 'crossover' ? (effectiveDefaultBottle) : '')
                          });
                        }}
                        className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-4 py-2 pr-8 outline-none appearance-none transition-colors truncate"
                      >
                        <option value="crossover">CrossOver</option>
                        <option value="parallels">Parallels Desktop</option>
                        <option value="direct">Direct (原生 .app)</option>
                      </select>
                      <DropdownArrow />
                    </div>
                  </div>
                  <div className="min-w-0">
                    <label className="block text-sm font-medium mb-2 truncate">
                      {formData.runMode === 'parallels' ? '指定虚拟机 (Applications)' : (formData.runMode === 'direct' ? '指定运行前执行命令' : '指定运行容器 (Bottle)')}
                    </label>
                    {formData.runMode === 'direct' ? (
                      <div className="flex gap-2">
                        <input 
                          readOnly 
                          value={formData.bottleName || ''} 
                          placeholder="默认为空" 
                          onClick={() => handleOpenScriptModal(null, formData.bottleName || '')}
                          className="flex-1 cursor-pointer bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-4 py-2 outline-none truncate hover:bg-black/10 transition-colors"
                        />
                        <button onClick={() => handleOpenScriptModal(null, formData.bottleName || '')} className="px-3 bg-black/5 dark:bg-white/10 rounded-lg hover:bg-black/10 dark:hover:bg-white/20 transition-colors">
                          <FileCode2 size={20} />
                        </button>
                      </div>
                    ) : (
                      <div className="relative">
                        <select 
                          value={formData.bottleName || ''} 
                          onChange={e => setFormData({ ...formData, bottleName: e.target.value })}
                          className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-4 py-2 pr-8 outline-none appearance-none transition-colors truncate"
                        >
                          {formData.runMode === 'parallels' ? (
                            <>
                              <option value="">-- 请选择 --</option>
                              {pdVms.map(vm => <option key={vm} value={vm}>{vm}</option>)}
                            </>
                          ) : (
                            <>
                              {formData.bottleName && !bottles.includes(formData.bottleName) && (
                                <option value={formData.bottleName}>{formData.bottleName} (当前)</option>
                              )}
                              {bottles.map(b => <option key={b} value={b}>{b}</option>)}
                            </>
                          )}
                        </select>
                        <DropdownArrow />
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">可执行文件路径</label>
                  <div className="flex gap-2">
                    <input value={formData.executablePath || ''} readOnly className="flex-1 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-4 py-2 outline-none" />
                    <button onClick={async () => {
                        let selected;
                        // 修复 2：针对 .app 使用特殊的 extensions 过滤器，而不是 directory: true
                        if (formData.runMode === 'direct') {
                          const res = await open({ filters: [{ name: 'Application', extensions: ['app'] }] }); 
                          selected = Array.isArray(res) ? res[0] : res;
                        } else {
                          const res = await open({ filters: [{ name: 'Executable', extensions: ['exe'] }] });
                          selected = Array.isArray(res) ? res[0] : res;
                        }
                        if (selected && typeof selected === 'string') setFormData({ ...formData, executablePath: selected });
                      }} className="px-4 py-2 bg-black/5 dark:bg-white/10 rounded-lg hover:bg-black/10 dark:hover:bg-white/20 transition-colors">
                      <FolderOpen size={20} />
                    </button>
                  </div>
                </div>

                {formData.runMode === 'crossover' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="min-w-0">
                      <label className="block text-sm font-medium mb-2 truncate">命令行参数</label>
                      <input
                        value={formData.commandArgs || ''}
                        onChange={e => setFormData({ ...formData, commandArgs: e.target.value })}
                        className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-4 py-2 outline-none"
                        placeholder="例如 --fullscreen --language=zh_CN"
                      />
                    </div>
                    <div className="min-w-0">
                      <label className="block text-sm font-medium mb-2 truncate">环境变量</label>
                      <input
                        value={formData.envVars || ''}
                        onChange={e => setFormData({ ...formData, envVars: e.target.value })}
                        className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-4 py-2 outline-none"
                        placeholder="例如 WINEDLLOVERRIDES=msvcr100=n,b"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="min-w-0">
                      <label className="block text-sm font-medium mb-2 truncate">硬盘游戏根目录</label>
                      <div className="flex gap-2">
                        <input
                          value={formData.diskGameRoot || ''}
                          onChange={e => setFormData({ ...formData, diskGameRoot: e.target.value })}
                          className="flex-1 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-4 py-2 outline-none"
                          placeholder="例如 /Volumes/xxx/games"
                        />
                        <button
                          onClick={async () => {
                            const selected = await open({ directory: true, defaultPath: formData.diskGameRoot || config.defaultDiskGameRoot || undefined });
                            if (selected && typeof selected === 'string') {
                              setFormData({ ...formData, diskGameRoot: selected });
                            }
                          }}
                          className="px-4 py-2 bg-black/5 dark:bg-white/10 rounded-lg hover:bg-black/10 dark:hover:bg-white/20 transition-colors"
                        >
                          <FolderOpen size={20} />
                        </button>
                      </div>
                    </div>

                    <div className="min-w-0">
                      <label className="block text-sm font-medium mb-2 truncate">本机游戏根目录</label>
                      <div className="flex gap-2">
                        <input
                          value={formData.localGameRoot || ''}
                          onChange={e => setFormData({ ...formData, localGameRoot: e.target.value })}
                          className="flex-1 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-4 py-2 outline-none"
                          placeholder="例如 ~/games"
                        />
                        <button
                          onClick={async () => {
                            const selected = await open({ directory: true, defaultPath: formData.localGameRoot || config.defaultLocalGameRoot || undefined });
                            if (selected && typeof selected === 'string') {
                              setFormData({ ...formData, localGameRoot: selected });
                            }
                          }}
                          className="px-4 py-2 bg-black/5 dark:bg-white/10 rounded-lg hover:bg-black/10 dark:hover:bg-white/20 transition-colors"
                        >
                          <FolderOpen size={20} />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div className="min-w-0">
                      <label className="block text-sm font-medium mb-2 truncate">游戏文件相对目录</label>
                      <div className="flex gap-2">
                        <input
                          value={formData.gameRelativeDir || ''}
                          onChange={e => setFormData({ ...formData, gameRelativeDir: e.target.value })}
                          className="flex-1 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-4 py-2 outline-none"
                          placeholder="例如 CLANNAD"
                        />
                        <button
                          onClick={handleSelectRelativeDir}
                          className="px-4 py-2 bg-black/5 dark:bg-white/10 rounded-lg hover:bg-black/10 dark:hover:bg-white/20 transition-colors"
                        >
                          <FolderOpen size={20} />
                        </button>
                      </div>
                    </div>

                    <div className="min-w-0">
                      <label className="block text-sm font-medium mb-2 truncate">设置当前游戏文件状态</label>
                      <div className="border border-black/10 dark:border-white/10 rounded-xl overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setIsGameFileStatusOpen(!isGameFileStatusOpen)}
                          className="w-full text-left p-3 bg-black/5 hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10 transition-colors flex justify-between items-center"
                        >
                          <span className="font-medium">{getStatusLabel(formData.gameFileStatus)}</span>
                          <ChevronDown className={`transition-transform duration-300 ${isGameFileStatusOpen ? 'rotate-180' : ''}`} size={18} />
                        </button>
                        <AnimatePresence>
                          {isGameFileStatusOpen && (
                            <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                              <div className="p-2 border-t border-black/10 dark:border-white/10 space-y-1">
                                <button
                                  type="button"
                                  onClick={() => { setFormData({ ...formData, gameFileStatus: 'disk' }); setIsGameFileStatusOpen(false); }}
                                  className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-left"
                                >
                                  <HardDrive size={16} /> 硬盘
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setFormData({ ...formData, gameFileStatus: 'local' }); setIsGameFileStatusOpen(false); }}
                                  className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-left"
                                >
                                  <Laptop size={16} /> 本机
                                </button>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>

                  <div>
                    <button
                      onClick={handleMigrateGameFiles}
                      disabled={isMigratingGameFiles}
                      className="w-full px-4 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
                    >
                      {isMigratingGameFiles ? <Loader2 size={18} className="animate-spin" /> : <ArrowLeftRight size={18} />}
                      进行迁移
                    </button>
                  </div>
                </>
                )}

                <div>
                  <label className="block text-sm font-medium mb-2">版本备注 (Info)</label>
                  <textarea rows={3} placeholder="填写一些备注信息..." value={formData.info || ''} onChange={e => setFormData({ ...formData, info: e.target.value })} className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-4 py-2 outline-none resize-none" />
                </div>

                {selectedId ? (
                  <div className="flex justify-end pt-2">
                    <span className="text-xs text-gray-400 flex items-center gap-1.5">
                      <CheckCircle size={14} className="text-green-500" /> 修改会自动保存
                    </span>
                  </div>
                ) : (
                  <div className="flex justify-end pt-4 border-t border-black/10 dark:border-white/10">
                    <button onClick={handleSave} className="px-8 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2 shadow-lg shadow-blue-500/30">
                      <Save size={18} /> 保存
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* ---------- 全部实例总览 ---------- */
          <>
            {/* 标题栏 */}
            <div className="px-8 pt-8 pb-4 flex justify-between items-center shrink-0 flex-wrap gap-3">
              <h1 className="text-2xl font-bold tracking-tight">全部实例</h1>
              <div className="flex items-center gap-2">
                {/* 排序 */}
                <div className="relative">
                  <Tooltip label="排序">
                    <button onClick={() => { setIsSortMenuOpen(!isSortMenuOpen); setIsFilterMenuOpen(false); }} className="p-2 rounded-lg bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
                      <ArrowDownWideNarrow size={18} />
                    </button>
                  </Tooltip>
                  <AnimatePresence>
                    {isSortMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-30" onClick={() => setIsSortMenuOpen(false)} />
                        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="absolute right-0 top-full mt-2 w-60 bg-white dark:bg-[#252525] border border-black/10 dark:border-white/10 rounded-lg shadow-xl z-40 overflow-hidden">
                          <button onClick={() => { setSortMode('recent'); setIsSortMenuOpen(false); }} className={clsx("w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-2", sortMode === 'recent' ? "text-blue-500 font-semibold" : "hover:bg-black/5 dark:hover:bg-white/5")}>
                            按照最近运行时间排序
                          </button>
                          <button onClick={() => { setSortMode('name'); setIsSortMenuOpen(false); }} className={clsx("w-full text-left px-4 py-3 text-sm transition-colors flex items-center gap-2 border-t border-black/5 dark:border-white/5", sortMode === 'name' ? "text-blue-500 font-semibold" : "hover:bg-black/5 dark:hover:bg-white/5")}>
                            按照实例名称排序
                          </button>
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>

                {/* 筛选 */}
                <div className="relative">
                  <Tooltip label="筛选">
                    <button onClick={() => { setIsFilterMenuOpen(!isFilterMenuOpen); setIsSortMenuOpen(false); }} className="relative p-2 rounded-lg bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
                      <SlidersHorizontal size={18} />
                      {activeFilterCount > 0 && (
                        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-blue-500 text-white text-[10px] flex items-center justify-center font-bold">{activeFilterCount}</span>
                      )}
                    </button>
                  </Tooltip>
                  <AnimatePresence>
                    {isFilterMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-30" onClick={() => setIsFilterMenuOpen(false)} />
                        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-[#252525] border border-black/10 dark:border-white/10 rounded-lg shadow-xl z-40 overflow-hidden p-2">
                          <div className="px-3 py-1.5 text-xs text-gray-400 font-semibold uppercase tracking-wider">运行模式</div>
                          {([
                            ['crossover', 'CrossOver'],
                            ['parallels', 'Parallels'],
                            ['direct', 'Direct'],
                          ] as [keyof FilterState, string][]).map(([key, label]) => (
                            <label key={key} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-sm">
                              <input type="checkbox" checked={filters[key]} onChange={e => setFilters(prev => ({ ...prev, [key]: e.target.checked }))} className="w-4 h-4 rounded text-blue-500 accent-blue-500" />
                              <span className="font-medium">{label}</span>
                            </label>
                          ))}
                          <div className="h-px bg-black/10 dark:bg-white/10 my-2" />
                          {([
                            ['starred', '仅显示星标的实例'],
                            ['playing', '仅显示正在游玩的实例'],
                            ['finished', '仅显示已通关的实例'],
                          ] as [keyof FilterState, string][]).map(([key, label]) => (
                            <label key={key} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-sm">
                              <input type="checkbox" checked={filters[key]} onChange={e => setFilters(prev => ({ ...prev, [key]: e.target.checked }))} className="w-4 h-4 rounded text-blue-500 accent-blue-500" />
                              <span className="font-medium">{label}</span>
                            </label>
                          ))}
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>

                {/* 视图切换 */}
                <div className="flex items-center bg-black/5 dark:bg-white/5 rounded-lg p-1">
                  <Tooltip label="列表视图">
                    <button onClick={() => setViewMode('list')} className={clsx("p-2 rounded-md transition-colors", viewMode === 'list' ? "bg-white dark:bg-white/10 text-blue-500 shadow-sm" : "text-gray-500 hover:text-gray-800 dark:hover:text-white")}>
                      <List size={16} />
                    </button>
                  </Tooltip>
                  <Tooltip label="网格视图">
                    <button onClick={() => setViewMode('grid')} className={clsx("p-2 rounded-md transition-colors", viewMode === 'grid' ? "bg-white dark:bg-white/10 text-blue-500 shadow-sm" : "text-gray-500 hover:text-gray-800 dark:hover:text-white")}>
                      <LayoutGrid size={16} />
                    </button>
                  </Tooltip>
                </div>

                {/* 启动游戏 */}
                <button onClick={handleLaunchSelected} className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-all shadow-md hover:shadow-blue-500/30 active:scale-95">
                  <Play size={16} /> 启动游戏
                </button>
              </div>
            </div>

            {/* 实例列表 */}
            <div ref={cardsContainerRef} className="flex-1 overflow-y-auto px-8 pb-8 custom-scrollbar min-h-0">
              {instances.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-500">
                  <Box size={64} className="mb-4 opacity-20" />
                  <p>目前还没有任何实例，点击左下角导入吧！</p>
                </div>
              ) : filteredSorted.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-500">
                  <Box size={64} className="mb-4 opacity-20" />
                  <p>没有符合当前筛选条件的实例</p>
                </div>
              ) : viewMode === 'list' ? (
                /* ----- 列表视图 (参考 SJMCL: 灰色整体 + 细线分隔) ----- */
                <div className="rounded-xl overflow-hidden bg-[#FAFAFA] dark:bg-[#2E2E2E] border border-black/5 dark:border-white/10 divide-y divide-black/5 dark:divide-white/10">
                  {filteredSorted.map(inst => (
                    <div key={inst.id} data-instance-id={inst.id} className={clsx(
                      "flex items-center gap-4 px-4 py-3 transition-colors",
                      effectiveListSelection?.id === inst.id
                        ? "bg-black/5 dark:bg-white/10"
                        : "hover:bg-black/5 dark:hover:bg-white/5"
                    )}>
                      {/* 单选圆形选择框 */}
                      <button
                        onClick={() => setListSelectedId(inst.id)}
                        className={clsx(
                          "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                          effectiveListSelection?.id === inst.id ? "border-blue-500" : "border-gray-300 dark:border-gray-600 hover:border-blue-400"
                        )}
                      >
                        {effectiveListSelection?.id === inst.id && <div className="w-3 h-3 rounded-full bg-blue-500" />}
                      </button>

                      {/* 中间信息 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-base text-gray-800 dark:text-gray-200 truncate" title={inst.name}>{inst.name}</h3>
                          {inst.isStarred && <Star size={15} className="text-yellow-400 shrink-0" fill="currentColor" />}
                          {inst.isPlaying && <Gamepad2 size={15} className="text-green-500 shrink-0" />}
                          {inst.isFinished && <Flag size={15} className="text-blue-500 shrink-0" fill="currentColor" />}
                        </div>
                        <div className="text-sm text-gray-500 truncate">
                          {getRunModeLabel(inst)}
                          {inst.info ? <span className="ml-2">· {inst.info}</span> : null}
                        </div>
                      </div>

                      {/* 右侧操作 */}
                      <div className="flex items-center gap-1 shrink-0">
                        <Tooltip label="打开文件夹">
                          <button onClick={() => handleOpenExecutableFolder(inst.executablePath)} className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-gray-500 hover:text-gray-800 dark:hover:text-white">
                            <FolderOpen size={18} />
                          </button>
                        </Tooltip>
                        <Tooltip label="编辑实例">
                          <button onClick={() => openDetail(inst)} className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-gray-500 hover:text-blue-500">
                            <Pencil size={18} />
                          </button>
                        </Tooltip>
                        <Tooltip label="删除实例">
                          <button onClick={() => setDeleteModal({ isOpen: true, instance: inst })} className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-gray-500 hover:text-red-500">
                            <Trash2 size={18} />
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                /* ----- 网格视图 ----- */
                <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
                  {filteredSorted.map(inst => (
                    <div data-instance-id={inst.id} key={inst.id} className="group relative rounded-xl overflow-hidden shadow-sm hover:shadow-xl bg-white dark:bg-[#252525] border border-black/5 dark:border-white/5 transition-all duration-300">
                      <div className="aspect-[3/4] relative bg-black/5 dark:bg-black/50 overflow-hidden rounded-t-xl">
                        {inst.backgroundImage ? (
                          <img src={inst.backgroundImage} className="w-full h-full object-cover transition-all duration-300 group-hover:blur-sm group-hover:scale-105 group-hover:brightness-50" alt={inst.name} />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center transition-all duration-300 group-hover:blur-sm group-hover:brightness-50"><Box size={48} className="text-gray-400 opacity-30" /></div>
                        )}

                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 gap-3">
                          <button onClick={(e) => { e.stopPropagation(); onLaunch(inst); }} className="p-2.5 bg-blue-500 text-white rounded-full hover:bg-blue-600 hover:scale-110 transition-all shadow-lg"><Play size={20} className="ml-0.5" /></button>
                          <button onClick={(e) => { e.stopPropagation(); openDetail(inst); }} className="p-2.5 bg-white/20 backdrop-blur-md text-white rounded-full hover:bg-white/30 hover:scale-110 transition-all shadow-lg"><Settings size={20} /></button>
                        </div>
                      </div>

                      {/* 右上角标识图标 + ··· 菜单（置于图片容器外，避免被裁剪） */}
                      <div className="absolute top-2 right-2 flex items-center gap-1 z-20">
                        {inst.isStarred && <span className="w-5 h-5 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center"><Star size={12} className="text-yellow-400" fill="currentColor" /></span>}
                        {inst.isPlaying && <span className="w-5 h-5 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center"><Gamepad2 size={12} className="text-green-400" /></span>}
                        {inst.isFinished && <span className="w-5 h-5 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center"><Flag size={12} className="text-blue-400" fill="currentColor" /></span>}
                        <div className="relative">
                          <button onClick={(e) => { e.stopPropagation(); setGridMenuId(prev => prev === inst.id ? null : inst.id); }} className="w-5 h-5 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center text-white hover:bg-black/70 transition-colors">
                            <Ellipsis size={12} />
                          </button>
                          {gridMenuId === inst.id && (
                            <>
                              <div className="fixed inset-0 z-30" onClick={() => setGridMenuId(null)} />
                              <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-[#252525] border border-black/10 dark:border-white/10 rounded-lg shadow-xl z-40 overflow-hidden">
                                <button onClick={() => { setGridMenuId(null); handleOpenExecutableFolder(inst.executablePath); }} className="w-full text-left px-4 py-3 text-sm hover:bg-black/5 dark:hover:bg-white/5 transition-colors flex items-center gap-2">
                                  <FolderOpen size={14} /> 打开文件夹
                                </button>
                                <button onClick={() => { setGridMenuId(null); openDetail(inst); }} className="w-full text-left px-4 py-3 text-sm hover:bg-black/5 dark:hover:bg-white/5 transition-colors flex items-center gap-2 border-t border-black/5 dark:border-white/5">
                                  <Pencil size={14} /> 编辑实例
                                </button>
                                <button onClick={() => { setGridMenuId(null); setDeleteModal({ isOpen: true, instance: inst }); }} className="w-full text-left px-4 py-3 text-sm hover:bg-red-500/10 transition-colors flex items-center gap-2 border-t border-black/5 dark:border-white/5 text-red-500">
                                  <Trash2 size={14} /> 删除实例
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="p-3">
                        <h3 className="font-semibold text-[14px] truncate text-gray-800 dark:text-gray-200" title={inst.name}>{inst.name}</h3>
                        <p className="text-xs text-gray-500 truncate mt-0.5">
                          {getRunModeLabel(inst)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* ===== 选择及检索弹窗 ===== */}
      <AnimatePresence>
        {importState !== 'none' && importState !== 'manual_form' && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }} className="bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh] border border-white/10">
              <div className="px-6 py-4 border-b border-black/10 dark:border-white/10 flex justify-between items-center bg-black/5 dark:bg-white/5">
                <h2 className="text-lg font-semibold">{importState === 'choice' ? '选择导入方式' : importState === 'search_params' ? '指定检索信息' : '选择匹配的游戏'}</h2>
                <button onClick={() => setImportState('none')} className="p-2 hover:bg-black/10 dark:hover:bg-white/10 rounded-full transition-colors"><X size={20} /></button>
              </div>

              <div className="p-8 overflow-y-auto overflow-x-hidden custom-scrollbar">
                {importState === 'choice' && (
                  <div className="grid grid-cols-2 gap-6">
                    <button onClick={() => setImportState('search_params')} className="group flex flex-col items-center justify-center p-8 border-2 border-transparent bg-blue-500/5 hover:bg-blue-500/10 hover:border-blue-500/30 rounded-2xl transition-all">
                      <div className="p-4 bg-blue-500/10 rounded-full mb-4 group-hover:scale-110 transition-transform"><Search size={40} className="text-blue-500" /></div>
                      <span className="font-semibold text-lg text-blue-500">搜索导入</span>
                    </button>
                    <button onClick={() => { setFormData({ id: crypto.randomUUID(), runMode: 'crossover', bottleName: effectiveDefaultBottle }); setImportState('manual_form'); }} className="group flex flex-col items-center justify-center p-8 border-2 border-transparent bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 hover:border-gray-500/30 rounded-2xl transition-all">
                      <div className="p-4 bg-black/5 dark:bg-white/10 rounded-full mb-4 group-hover:scale-110 transition-transform"><Box size={40} className="text-gray-500 dark:text-gray-400" /></div>
                      <span className="font-semibold text-lg">手动导入</span>
                    </button>
                  </div>
                )}
                {importState === 'search_params' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="min-w-0">
                        <label className="block text-sm font-medium mb-2 truncate">运行方式</label>
                        <div className="relative">
                          <select
                            className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-4 py-3 appearance-none focus:outline-none transition-all truncate"
                            value={formData.runMode || 'crossover'}
                            onChange={(e) => {
                              const mode = e.target.value as 'crossover' | 'parallels' | 'direct';
                              setFormData({ 
                                ...formData, 
                                runMode: mode,
                                executablePath: '', // 切换模式重置路径，以免 .exe 和 .app 互串
                                bottleName: mode === 'parallels' ? (config.defaultPdVm || pdVms[0] || '') : (mode === 'crossover' ? (effectiveDefaultBottle) : '')
                              });
                            }}
                          >
                            <option value="crossover">CrossOver</option>
                            <option value="parallels">Parallels Desktop</option>
                            <option value="direct">Direct (原生 .app)</option>
                          </select>
                          <DropdownArrow />
                        </div>
                      </div>
                                      
                      <div className="min-w-0">
                        <label className="block text-sm font-medium mb-2 truncate">
                          {formData.runMode === 'parallels' ? '虚拟机 (Applications)' : (formData.runMode === 'direct' ? '指定运行前执行命令' : '指定运行容器 (Bottle)')}
                        </label>
                        {formData.runMode === 'direct' ? (
                          <div className="flex gap-2">
                            <input 
                              readOnly 
                              value={formData.bottleName || ''} 
                              placeholder="默认为空" 
                              onClick={() => handleOpenScriptModal(null, formData.bottleName || '')}
                              className="flex-1 cursor-pointer bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-4 py-3 outline-none truncate hover:bg-black/10 transition-colors"
                            />
                            <button onClick={() => handleOpenScriptModal(null, formData.bottleName || '')} className="px-3 bg-black/5 dark:bg-white/10 rounded-lg hover:bg-black/10 dark:hover:bg-white/20 transition-colors">
                              <FileCode2 size={20} />
                            </button>
                          </div>
                        ) : (
                          <div className="relative">
                            <select
                              className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-4 py-3 appearance-none focus:outline-none transition-all truncate"
                              value={formData.bottleName || ''}
                              onChange={(e) => setFormData({ ...formData, bottleName: e.target.value })}
                            >
                              {formData.runMode === 'parallels' ? (
                                <>
                                  <option value="">-- 请选择 --</option>
                                  {pdVms.map(vm => <option key={vm} value={vm}>{vm}</option>)}
                                </>
                              ) : (
                                <>
                                  {formData.bottleName && !bottles.includes(formData.bottleName) && (
                                    <option value={formData.bottleName}>{formData.bottleName} (当前)</option>
                                  )}
                                  {bottles.map(b => <option key={b} value={b}>{b}</option>)}
                                </>
                              )}
                            </select>
                            <DropdownArrow />
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-2">
                        选择可执行文件 {formData.runMode === 'direct' ? '(.app)' : '(.exe)'}
                      </label>
                      <div className="flex gap-2">
                        <input type="text" value={searchExecPath} readOnly className="flex-1 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-4 py-3 outline-none" />
                        <button onClick={async () => {
                            let selected;
                            // 修复 2：针对 .app 使用特殊的 extensions 过滤器，而不是 directory: true
                            if (formData.runMode === 'direct') {
                              const res = await open({ filters: [{ name: 'Application', extensions: ['app'] }] }); 
                              selected = Array.isArray(res) ? res[0] : res;
                            } else {
                              const res = await open({ filters: [{ name: 'Executable', extensions: ['exe'] }] });
                              selected = Array.isArray(res) ? res[0] : res;
                            }
                            if (selected && typeof selected === 'string') setSearchExecPath(selected);
                          }} className="px-5 py-3 bg-black/5 dark:bg-white/10 rounded-lg hover:bg-black/10 dark:hover:bg-white/20 transition-colors flex items-center justify-center"><FolderOpen size={20} /></button>
                      </div>
                    </div>

                    <div className="flex justify-between items-center pt-6 mt-4 border-t border-black/5 dark:border-white/5">
                      <button onClick={() => setImportState('choice')} className="text-gray-500 px-4 py-2">上一步</button>
                      <button disabled={!searchExecPath || isSearching} onClick={handleSearchGame} className="px-8 py-3 bg-blue-500 text-white rounded-lg flex items-center gap-2">
                        {isSearching ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />} 开始检索
                      </button>
                    </div>
                  </div>
                )}
                {importState === 'search_results' && (
                  <div className="space-y-4">
                    {searchResults.length === 0 ? (
                      <div className="text-center py-16 text-gray-500 bg-black/5 dark:bg-white/5 rounded-xl border border-dashed"><p className="text-lg">未检索到匹配结果</p></div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-h-[50vh] overflow-y-auto custom-scrollbar pr-2">
                        {searchResults.map(res => (
                          <button key={res.id + res.source} onClick={() => { setFormData({ ...formData, id: crypto.randomUUID(), name: res.title, backgroundImage: res.cover, executablePath: searchExecPath, info: '' }); setImportState('manual_form'); }} className="group flex flex-col bg-black/5 dark:bg-[#2a2a2a] rounded-xl overflow-hidden hover:ring-2 hover:ring-blue-500 border border-transparent dark:border-white/5 text-left">
                            <div className="aspect-[16/9] w-full relative"><img src={res.cover} className="w-full h-full object-cover group-hover:scale-105 transition-transform" alt="cover" /><div className="absolute top-2 right-2 px-2 py-0.5 text-[10px] font-bold uppercase bg-black/70 text-white rounded">{res.source}</div></div>
                            <div className="p-3"><div className="font-semibold text-sm truncate" title={res.title}>{res.title}</div></div>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex justify-between items-center pt-6 mt-4 border-t border-black/10 dark:border-white/10">
                      <button onClick={() => setImportState('search_params')} className="text-gray-500 px-4 py-2">重新选择</button>
                      <button onClick={() => { setFormData({ ...formData, id: crypto.randomUUID(), executablePath: searchExecPath }); setImportState('manual_form'); }} className="px-6 py-2 bg-black/5 dark:bg-white/10 rounded-lg">手动填写</button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ===== 批量导入弹窗 ===== */}
      <AnimatePresence>
        {isBatchModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }} className="bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-2xl w-full max-w-6xl overflow-hidden flex flex-col h-[85vh] border border-white/10">
              <div className="px-6 py-4 border-b border-black/10 dark:border-white/10 flex justify-between items-center bg-black/5 dark:bg-white/5 shrink-0">
                <h2 className="text-lg font-semibold flex items-center gap-2"><FolderOpen size={20} className="text-blue-500" /> 批量导入游戏</h2>
                <button onClick={() => setIsBatchModalOpen(false)} className="p-2 hover:bg-black/10 dark:hover:bg-white/10 rounded-full transition-colors"><X size={20} /></button>
              </div>

              <div className="flex-1 overflow-hidden relative flex flex-col bg-white dark:bg-[#1e1e1e]">
                {editingBatchItemId ? (() => {
                  const item = batchItems.find(i => i.id === editingBatchItemId)!;
                  return (
                    <div className="absolute inset-0 z-10 p-6 flex flex-col overflow-y-auto custom-scrollbar bg-white dark:bg-[#1e1e1e]">
                      <button onClick={() => setEditingBatchItemId(null)} className="mb-4 flex items-center gap-2 text-gray-500 self-start"><ArrowLeft size={18} /> 返回</button>
                      <h3 className="text-xl font-bold mb-4">编辑条目: {item.dirName}</h3>
                      <div className="mb-6">
                        {item.searchResults.length === 0 ? (
                          <div className="text-sm text-gray-400 bg-black/5 p-4 rounded-lg">暂无匹配项</div>
                        ) : (
                          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 max-h-48 overflow-y-auto custom-scrollbar">
                             {item.searchResults.map(res => (
                               <button key={res.id + res.source} onClick={() => { updateBatchItem(item.id, { matchedResult: res }); setEditingBatchItemId(null); }} className={`flex flex-col rounded-xl overflow-hidden text-left border-2 ${item.matchedResult?.id === res.id ? 'border-blue-500' : 'border-transparent bg-black/5'}`}>
                                 <div className="aspect-[16/9] w-full"><img src={res.cover} className="w-full h-full object-cover" alt="cover" /></div>
                                 <div className="p-2 text-xs truncate">{res.title}</div>
                               </button>
                             ))}
                          </div>
                        )}
                      </div>
                      <div className="border-t border-black/10 pt-6">
                         <div className="space-y-4 max-w-2xl">
                           <div><label className="block text-xs mb-1">游戏名称</label><input className="w-full bg-black/5 rounded px-3 py-2 outline-none text-sm" value={item.manualInfo.name || ''} onChange={e => updateBatchItem(item.id, { manualInfo: { ...item.manualInfo, name: e.target.value }})} placeholder={`默认为: ${item.matchedResult?.title || item.dirName}`} /></div>
                           <div><label className="block text-xs mb-1">封面 URL</label><input className="w-full bg-black/5 rounded px-3 py-2 outline-none text-sm" value={item.manualInfo.backgroundImage || ''} onChange={e => updateBatchItem(item.id, { manualInfo: { ...item.manualInfo, backgroundImage: e.target.value }})} /></div>
                           <button onClick={() => setEditingBatchItemId(null)} className="px-6 py-2 bg-blue-500 text-white rounded-lg text-sm">确认返回</button>
                         </div>
                      </div>
                    </div>
                  );
                })() : (
                  <div className="flex-1 overflow-y-auto custom-scrollbar">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="sticky top-0 bg-gray-100 dark:bg-[#2a2a2a] z-10 shadow-sm">
                        <tr>
                          <th className="p-4 w-12 text-center">
                            <input type="checkbox" className="w-4 h-4 rounded text-blue-500" checked={isAllSelected} onChange={toggleSelectAll} />
                          </th>
                          <th className="p-4 font-semibold">识别目录名</th>
                          <th className="p-4 font-semibold">执行程序 (Exe)</th>
                          <th className="p-4 w-32 font-semibold">运行方式</th>
                          <th className="p-4 w-40 font-semibold">运行容器 / 脚本</th>
                          <th className="p-4 w-28 font-semibold">匹配状态</th>
                          <th className="p-4 w-20 font-semibold text-right">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black/5 dark:divide-white/5">
                        {batchItems.map(item => (
                          <tr key={item.id} className={`hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${!item.selected ? 'opacity-50' : ''}`}>
                            <td className="p-4 text-center">
                              <input type="checkbox" className="w-4 h-4 rounded text-blue-500" checked={item.selected} onChange={e => updateBatchItem(item.id, {selected: e.target.checked})} />
                            </td>
                            <td className="p-4 font-medium max-w-[150px] truncate" title={item.dirName}>
                              {item.manualInfo.name || item.matchedResult?.title || item.dirName}
                            </td>
                            <td className="p-4 max-w-[180px]">
                              <div className="relative">
                                <select 
                                  value={item.selectedExec} 
                                  onChange={e => updateBatchItem(item.id, {selectedExec: e.target.value})} 
                                  className="w-full bg-transparent border border-black/10 dark:border-white/10 rounded px-2 py-1.5 pr-8 outline-none truncate appearance-none"
                                >
                                  {item.executables.map((exe, i) => <option key={i} title={exe} value={exe}>{exe.split(/[/\\]/).slice(-2).join('/')}</option>)}
                                </select>
                                <DropdownArrow />
                              </div>
                            </td>
                            <td className="p-4">
                              <div className="relative">
                                <select 
                                  value={item.runMode} 
                                  onChange={e => {
                                    const mode = e.target.value as 'crossover' | 'parallels' | 'direct';
                                    updateBatchItem(item.id, {
                                      runMode: mode,
                                      bottleName: mode === 'parallels' ? (config.defaultPdVm || pdVms[0] || '') : (mode === 'crossover' ? (effectiveDefaultBottle) : '')
                                    });
                                  }} 
                                  className="w-full bg-transparent border border-black/10 dark:border-white/10 rounded px-2 py-1.5 pr-8 outline-none appearance-none"
                                >
                                  <option value="crossover">CrossOver</option>
                                  <option value="parallels">Parallels</option>
                                  <option value="direct">Direct (.app)</option>
                                </select>
                                <DropdownArrow />
                              </div>
                            </td>
                            <td className="p-4">
                              {item.runMode === 'direct' ? (
                                <button onClick={() => handleOpenScriptModal(item.id, item.bottleName)} className="w-full text-left bg-black/5 hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10 border border-black/10 dark:border-white/10 rounded px-2 py-1.5 truncate">
                                  {item.bottleName || '无前置执行脚本 (点击设置)'}
                                </button>
                              ) : (
                                <div className="relative">
                                  <select 
                                    value={item.bottleName} 
                                    onChange={e => updateBatchItem(item.id, {bottleName: e.target.value})} 
                                    className="w-full bg-transparent border border-black/10 dark:border-white/10 rounded px-2 py-1.5 pr-8 outline-none appearance-none truncate"
                                  >
                                    {item.runMode === 'parallels' ? (
                                      <>
                                        <option value="">-- 请选择 --</option>
                                        {pdVms.map(vm => <option key={vm} value={vm}>{vm}</option>)}
                                      </>
                                    ) : (
                                      bottles.map(b => <option key={b} value={b}>{b}</option>)
                                    )}
                                  </select>
                                  <DropdownArrow />
                                </div>
                              )}
                            </td>
                            <td className="p-4">
                              {item.status === 'pending' && <span className="text-gray-400 flex items-center gap-1"><AlertCircle size={14}/> 待匹配</span>}
                              {item.status === 'matching' && <span className="text-blue-500 flex items-center gap-1"><Loader2 size={14} className="animate-spin"/> 匹配中</span>}
                              {item.status === 'matched' && <span className="text-green-500 flex items-center gap-1"><CheckCircle size={14}/> 已匹配</span>}
                              {item.status === 'unmatched' && <span className="text-red-400 flex items-center gap-1"><AlertCircle size={14}/> 未匹配</span>}
                            </td>
                            <td className="p-4 text-right">
                              <button onClick={() => setEditingBatchItemId(item.id)} className="text-blue-500 px-2 py-1 rounded hover:bg-blue-500/10">编辑</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="px-6 py-4 border-t border-black/10 dark:border-white/10 flex justify-between items-center bg-black/5 dark:bg-white/5 shrink-0">
                <div className="text-sm text-gray-500">共 {batchItems.length} 个游戏，已选 {batchItems.filter(i => i.selected).length} 个</div>
                <div className="flex gap-4">
                  <button disabled={isBatchMatching || batchItems.filter(i => i.selected).length === 0} onClick={handleStartBatchMatching} className="px-6 py-2 bg-indigo-500 text-white rounded-lg flex items-center gap-2">
                    {isBatchMatching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} 匹配
                  </button>
                  <button disabled={isBatchMatching} onClick={handleConfirmBatchImport} className="px-6 py-2 bg-blue-500 text-white rounded-lg flex items-center gap-2"><Save size={16} /> 导入</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ===== 脚本管理弹窗 ===== */}
      <AnimatePresence>
        {scriptModal.isOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            {/* 修复 1：将 max-w-md 改为 max-w-xl 增加弹窗宽度，避免底部按钮越界截断 */}
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col border border-white/10">
              <div className="px-6 py-4 border-b border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5">
                <h2 className="text-lg font-semibold">{scriptModal.view === 'select' ? '选择前置执行脚本' : '编辑脚本'}</h2>
              </div>

              {scriptModal.view === 'select' ? (
                <div className="p-6">
                  <div className="border border-black/10 dark:border-white/10 rounded-xl overflow-hidden mb-6">
                    <button 
                      className="w-full text-left p-4 bg-black/5 hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10 transition-colors flex justify-between items-center" 
                      onClick={() => setScriptModal(prev => ({...prev, isAccordionOpen: !prev.isAccordionOpen}))}
                    >
                      <span className="font-medium">导入现有脚本</span>
                      <ChevronDown className={`transition-transform duration-300 ${scriptModal.isAccordionOpen ? 'rotate-180' : ''}`} size={18}/>
                    </button>
                    <AnimatePresence>
                      {scriptModal.isAccordionOpen && (
                        <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                          <div className="p-2 border-t border-black/10 dark:border-white/10 max-h-48 overflow-y-auto custom-scrollbar">
                            {scripts.length === 0 ? (
                              <div className="text-gray-400 text-sm p-4 text-center">暂无可用脚本</div>
                            ) : (
                              scripts.map(s => (
                                <div 
                                  key={s} 
                                  onClick={() => setScriptModal(prev => ({...prev, selectedScript: s}))} 
                                  className={`p-3 rounded-lg cursor-pointer transition-colors text-sm ${scriptModal.selectedScript === s ? 'bg-blue-500 text-white' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}
                                >
                                  {s}.sh
                                </div>
                              ))
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <button 
                    onClick={handleEditScript}
                    className="w-full p-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl hover:border-blue-500 hover:text-blue-500 transition-colors flex items-center justify-center gap-2"
                  >
                    {scriptModal.selectedScript ? '编辑现有脚本' : '添加新脚本'}
                  </button>

                  <div className="flex justify-between items-center pt-6 mt-6 border-t border-black/10 dark:border-white/10">
                    <button onClick={() => setScriptModal(prev => ({...prev, isOpen: false}))} className="text-gray-500 px-4 py-2 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg">取消 / 关闭</button>
                    <button onClick={handleConfirmScript} className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">导入并应用</button>
                  </div>
                </div>
              ) : (
                <div className="p-6 flex flex-col h-[60vh]">
                  <textarea 
                    className="flex-1 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl p-4 font-mono text-sm outline-none resize-none custom-scrollbar mb-6"
                    placeholder="#!/bin/bash&#10;echo 'Hello World'"
                    value={scriptModal.editContent}
                    onChange={e => setScriptModal(prev => ({...prev, editContent: e.target.value}))}
                  />
                  
                  <div className="flex items-center justify-between border-t border-black/10 dark:border-white/10 pt-4">
                    <div className="flex items-center gap-2 flex-1 mr-4">
                      <span className="text-sm whitespace-nowrap">保存为:</span>
                      <input 
                        className="flex-1 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none" 
                        value={scriptModal.editName}
                        placeholder="脚本名称"
                        onChange={e => setScriptModal(prev => ({...prev, editName: e.target.value}))}
                      />
                      <span className="text-sm whitespace-nowrap text-gray-500">.sh</span>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => setScriptModal(prev => ({...prev, view: 'select'}))} className="px-4 py-2 text-gray-500 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg">上一步</button>
                      <button onClick={handleSaveScript} className="px-6 py-2 bg-blue-500 text-white rounded-lg flex items-center gap-2 hover:bg-blue-600"><Save size={16}/> 保存</button>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <DeleteModal isOpen={deleteModal.isOpen} instanceName={deleteModal.instance?.name || ''} onClose={() => setDeleteModal({ isOpen: false, instance: null })} onConfirm={handleDelete} />
    </div>
  );
}

function BadgeToggleBtn({ active, activeClass, onClick, title, children }: { active: boolean; activeClass: string; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <Tooltip label={title}>
      <button
        onClick={onClick}
        className={clsx(
          "p-1.5 rounded-lg transition-all",
          active ? activeClass : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300",
          active ? "bg-black/5 dark:bg-white/10" : "hover:bg-black/5 dark:hover:bg-white/5"
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function IconBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <Tooltip label={title}>
      <button
        onClick={onClick}
        className="p-2 rounded-lg bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
      >
        {children}
      </button>
    </Tooltip>
  );
}
