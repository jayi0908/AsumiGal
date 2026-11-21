export type RunMode = 'crossover' | 'parallels' | 'direct';
export type GameFileStatus = 'disk' | 'local';
export type ScreenshotTarget = 'game' | 'focused';

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
  runMode?: RunMode;
  gameFileStatus?: GameFileStatus;
  diskGameRoot?: string;
  localGameRoot?: string;
  gameRelativeDir?: string;
  commandArgs?: string;
  envVars?: string;
  workDir?: string;
  isStarred?: boolean;
  isPlaying?: boolean;
  isFinished?: boolean;
  screenshotCustomDir?: boolean;
  screenshotRootDir?: string;
  screenshotTarget?: ScreenshotTarget;
  locale?: string;
  wineDebug?: boolean;
}

export interface GameLogLine {
  instanceId: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'system';
  line: string;
}

export interface SearchResult {
  id: string;
  title: string;
  cover: string;
  source: string;
  url: string;
  date?: string | null;
  averageRating?: number | null;
  view?: number | null;
}

export interface ScreenshotItem {
  fileName: string;
  filePath: string;
  time: number;
}

export interface BatchItem {
  id: string;
  selected: boolean;
  dirName: string;
  executables: string[];
  selectedExec: string;
  runMode: RunMode;
  bottleName: string;
  status: 'pending' | 'matching' | 'matched' | 'unmatched';
  matchedResult: SearchResult | null;
  searchResults: SearchResult[];
  manualInfo: Partial<GameInstance>;
}
