import { React, run } from 'uebersicht';
import { theme as ITERM2_THEME, settings } from './lib/config.js';
import {
  getWidgetZIndex,
  reorderWidget,
  getScreenId,
  resolveActiveScreen,
  isScreenActive,
  calculateSnappedPosition,
  computeCrossScreenPreview,
  resolveDragEndAcrossScreens,
  broadcastWidgetMessage,
  initWidgetDesktopSync,
} from './lib/desktop.js';

function formatShellCommand(cmd) {
  if (!cmd) return '';
  let c = cmd.trim();
  if (c === 'fastfetch' || c.startsWith('fastfetch ')) {
    if (!c.includes('--pipe')) {
      c = `${c} --pipe false`;
    }
  }
  return `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" CLICOLOR_FORCE=1 FORCE_COLOR=1; zsh -l -c ${JSON.stringify(c)}`;
}

const configuredCommand = settings.command || settings.singleCommand || '';

export const refreshFrequency = settings.refreshFrequency !== undefined
  ? settings.refreshFrequency
  : false;

export const command = configuredCommand ? formatShellCommand(configuredCommand) : '';

const POS_KEY = 'shell_widget_position';
const STORAGE_INSTANCES_KEY = 'shell_widget_instances_v2';
const SIZE_KEY = 'shell_widget_size';
const STORAGE_SNAP_KEY = 'shell_widget_enable_snap';
const STORAGE_ACTIVE_SCREEN_KEY = 'shell_active_screen';
const SCREEN_MARGIN = 0;
const SNAP_THRESHOLD = settings.snapThreshold !== undefined ? settings.snapThreshold : 6;
const SNAP_EDGE_TOLERANCE = 3;
const SNAP_MARGIN_X = settings.snapMarginX !== undefined ? settings.snapMarginX : 15;
const SNAP_MARGIN_TOP = settings.snapMarginTop !== undefined ? settings.snapMarginTop : 14;
const SNAP_MARGIN_BOTTOM = settings.snapMarginBottom !== undefined ? settings.snapMarginBottom : 14;

const SNAP_MARGINS = {
  marginX: SNAP_MARGIN_X,
  marginTop: SNAP_MARGIN_TOP,
  marginBottom: SNAP_MARGIN_BOTTOM,
  threshold: SNAP_THRESHOLD,
  tolerance: SNAP_EDGE_TOLERANCE,
};

const getInitialSnapping = () => {
  try {
    const saved = localStorage.getItem(STORAGE_SNAP_KEY);
    if (saved !== null) {
      return saved === 'true';
    }
  } catch (e) {}
  return settings.enableSnapping !== undefined ? settings.enableSnapping : true;
};

const FG_MAP = {
  '30': ITERM2_THEME.black,
  '31': ITERM2_THEME.red,
  '32': ITERM2_THEME.green,
  '33': ITERM2_THEME.yellow,
  '34': ITERM2_THEME.blue,
  '35': ITERM2_THEME.magenta,
  '36': ITERM2_THEME.cyan,
  '37': ITERM2_THEME.white,
  '39': ITERM2_THEME.fg,
  '90': ITERM2_THEME.brightBlack,
  '91': ITERM2_THEME.brightRed,
  '92': ITERM2_THEME.brightGreen,
  '93': ITERM2_THEME.brightYellow,
  '94': ITERM2_THEME.brightBlue,
  '95': ITERM2_THEME.brightMagenta,
  '96': ITERM2_THEME.brightCyan,
  '97': ITERM2_THEME.brightWhite,
};

const BG_MAP = {
  '40': ITERM2_THEME.black,
  '41': ITERM2_THEME.red,
  '42': ITERM2_THEME.green,
  '43': ITERM2_THEME.yellow,
  '44': ITERM2_THEME.blue,
  '45': ITERM2_THEME.magenta,
  '46': ITERM2_THEME.cyan,
  '47': ITERM2_THEME.white,
  '49': 'transparent',
  '100': ITERM2_THEME.brightBlack,
  '101': ITERM2_THEME.brightRed,
  '102': ITERM2_THEME.brightGreen,
  '103': ITERM2_THEME.brightYellow,
  '104': ITERM2_THEME.brightBlue,
  '105': ITERM2_THEME.brightMagenta,
  '106': ITERM2_THEME.brightCyan,
  '107': ITERM2_THEME.brightWhite,
};

const COLOR_CUBE_STEPS = [0, 95, 135, 175, 215, 255];

function get256Color(n) {
  if (isNaN(n) || n < 0 || n > 255) return ITERM2_THEME.fg;
  if (n < 8) return FG_MAP[String(30 + n)] || ITERM2_THEME.fg;
  if (n < 16) return FG_MAP[String(90 + (n - 8))] || ITERM2_THEME.brightWhite;
  if (n < 232) {
    const idx = n - 16;
    const r = COLOR_CUBE_STEPS[Math.floor(idx / 36)];
    const g = COLOR_CUBE_STEPS[Math.floor((idx % 36) / 6)];
    const b = COLOR_CUBE_STEPS[idx % 6];
    return `rgb(${r}, ${g}, ${b})`;
  }
  const gray = 8 + (n - 232) * 10;
  return `rgb(${gray}, ${gray}, ${gray})`;
}

const getActiveScreen = () => {
  try {
    const saved = localStorage.getItem(STORAGE_ACTIVE_SCREEN_KEY);
    if (saved) return resolveActiveScreen(saved);
  } catch (e) {}
  return resolveActiveScreen(null);
};

const getInitialInstances = () => {
  const screenId = getScreenId();
  try {
    const savedCanonical = localStorage.getItem(STORAGE_INSTANCES_KEY);
    if (savedCanonical) {
      const parsed = JSON.parse(savedCanonical);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {}

  try {
    const saved = localStorage.getItem(`${POS_KEY}_instances_${screenId}`);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {}

  const defaultW = configuredCommand ? 520 : 420;
  const defaultH = configuredCommand ? 300 : 220;

  try {
    const saved = localStorage.getItem(`${POS_KEY}_${screenId}`) || localStorage.getItem(POS_KEY);
    const savedSize = localStorage.getItem(`${SIZE_KEY}_${screenId}`) || localStorage.getItem(SIZE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const parsedSize = savedSize ? JSON.parse(savedSize) : null;
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        return [{
          id: 'default',
          x: Math.max(SCREEN_MARGIN, parsed.x),
          y: Math.max(SCREEN_MARGIN, parsed.y),
          w: parsedSize?.w || defaultW,
          h: parsedSize?.h || defaultH,
        }];
      }
    }
  } catch (e) {}

  return [{
    id: 'default',
    x: SNAP_MARGIN_X,
    y: SNAP_MARGIN_TOP,
    w: defaultW,
    h: defaultH,
  }];
};

const saveInstances = (instances, targetScreenId) => {
  const screenId = targetScreenId || getScreenId();
  try {
    localStorage.setItem(STORAGE_INSTANCES_KEY, JSON.stringify(instances));
    localStorage.setItem(`${POS_KEY}_instances_${screenId}`, JSON.stringify(instances));
    if (instances && instances[0]) {
      const posJson = JSON.stringify({ x: instances[0].x, y: instances[0].y });
      const sizeJson = JSON.stringify({ w: instances[0].w, h: instances[0].h });
      localStorage.setItem(`${POS_KEY}_${screenId}`, posJson);
      localStorage.setItem(POS_KEY, posJson);
      localStorage.setItem(`${SIZE_KEY}_${screenId}`, sizeJson);
      localStorage.setItem(SIZE_KEY, sizeJson);
    }
  } catch (e) {}
};

const initialInstances = getInitialInstances();

export const initialState = {
  instances: initialInstances,
  activeScreen: getActiveScreen(),
  x: initialInstances[0]?.x ?? SNAP_MARGIN_X,
  y: initialInstances[0]?.y ?? SNAP_MARGIN_TOP,
  w: initialInstances[0]?.w ?? (configuredCommand ? 520 : 420),
  h: initialInstances[0]?.h ?? (configuredCommand ? 300 : 220),
  enableSnapping: getInitialSnapping(),
  isDragging: false,
  draggingInstanceId: null,
  isResizing: false,
  resizingInstanceId: null,
  dragStartX: 0,
  dragStartY: 0,
  startPosX: 0,
  startPosY: 0,
  lastClientX: 0,
  lastClientY: 0,
  lastBypassSnap: false,
  crossScreenPreview: null,
  resizeStartX: 0,
  resizeStartY: 0,
  startW: 0,
  startH: 0,
  lines: [],
  inputValue: '',
  history: [],
  historyIndex: -1,
  isRunning: false,
};

export const updateState = (event, previousState) => {
  if (!previousState) return initialState;

  if (event.type === 'UB/COMMAND_RAN') {
    if (event.error) {
      const errMsg = typeof event.error === 'string'
        ? event.error
        : (event.error?.message || String(event.error));
      return {
        ...previousState,
        isRunning: false,
        lines: [{ type: 'error', text: errMsg }],
      };
    }
    if (event.output && String(event.output).trim()) {
      return {
        ...previousState,
        isRunning: false,
        lines: [{ type: 'output', text: String(event.output) }],
      };
    }
    return {
      ...previousState,
      isRunning: false,
    };
  }

  if (event.type === 'MANUAL_REFRESH') {
    return {
      ...previousState,
      isRunning: true,
    };
  }

  if (event.type === 'COMMAND_START') {
    return {
      ...previousState,
      isRunning: true,
      lines: [...previousState.lines, { type: 'command', text: event.cmd }],
      history: [...previousState.history, event.cmd],
      historyIndex: -1,
      inputValue: '',
    };
  }

  if (event.type === 'COMMAND_OUTPUT') {
    return {
      ...previousState,
      isRunning: false,
      lines: [...previousState.lines, { type: event.lineType || 'output', text: event.text }],
    };
  }

  if (event.type === 'COMMAND_FINISHED') {
    return {
      ...previousState,
      isRunning: false,
    };
  }

  if (event.type === 'CANCEL_COMMAND') {
    return {
      ...previousState,
      isRunning: false,
      lines: [...previousState.lines, { type: 'command', text: '^C' }],
    };
  }

  if (event.type === 'ADD_LINE') {
    return {
      ...previousState,
      lines: [...previousState.lines, { type: event.lineType, text: event.text }],
    };
  }

  if (event.type === 'CLEAR_LINES' || event.type === 'CLEAR_OUTPUT') {
    return {
      ...previousState,
      lines: [],
    };
  }

  if (event.type === 'SET_INPUT') {
    return {
      ...previousState,
      inputValue: event.value,
      historyIndex: event.historyIndex !== undefined ? event.historyIndex : previousState.historyIndex,
    };
  }

  if (event.type === 'PUSH_HISTORY') {
    return {
      ...previousState,
      history: [...previousState.history, event.cmd],
      historyIndex: -1,
      inputValue: '',
    };
  }

  if (event.type === 'START_DRAG') {
    return {
      ...previousState,
      isDragging: true,
      draggingInstanceId: event.instanceId,
      dragStartX: event.clientX,
      dragStartY: event.clientY,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      startPosX: event.startPosX !== undefined ? event.startPosX : previousState.x,
      startPosY: event.startPosY !== undefined ? event.startPosY : previousState.y,
      startW: event.w || previousState.w || 420,
      startH: event.h || previousState.h || 220,
    };
  }

  if (event.type === 'MOVE_DRAG' && previousState.isDragging && previousState.draggingInstanceId) {
    const deltaX = event.clientX - previousState.dragStartX;
    const deltaY = event.clientY - previousState.dragStartY;
    const cardW = previousState.startW || previousState.w || 420;
    const cardH = previousState.startH || previousState.h || 220;

    const bypassSnap = previousState.enableSnapping === false || event.bypassSnap || event.metaKey;
    const { x: newX, y: newY } = calculateSnappedPosition(
      previousState.startPosX + deltaX,
      previousState.startPosY + deltaY,
      cardW,
      cardH,
      bypassSnap,
      true,
      SNAP_MARGINS
    );

    const updatedInstances = (previousState.instances || []).map((inst) => {
      if (inst.id === previousState.draggingInstanceId) {
        return { ...inst, x: newX, y: newY };
      }
      return inst;
    });

    const currentScreenId = getScreenId();
    const preview = computeCrossScreenPreview({
      currentScreenId,
      curX: newX,
      curY: newY,
      cardW,
      cardH,
    });

    broadcastWidgetMessage('shell', {
      type: 'CROSS_SCREEN_DRAG_PREVIEW',
      preview,
    });

    return {
      ...previousState,
      instances: updatedInstances,
      x: updatedInstances[0]?.x ?? newX,
      y: updatedInstances[0]?.y ?? newY,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      lastBypassSnap: bypassSnap,
    };
  }

  if (event.type === 'END_DRAG') {
    const draggingId = previousState.draggingInstanceId;
    const currentInst = (previousState.instances || []).find((i) => i.id === draggingId) || previousState.instances?.[0];
    const defaultW = configuredCommand ? 520 : 420;
    const defaultH = configuredCommand ? 300 : 220;
    const cardW = previousState.startW || previousState.w || defaultW;
    const cardH = previousState.startH || previousState.h || defaultH;
    const curX = currentInst?.x ?? previousState.x ?? 0;
    const curY = currentInst?.y ?? previousState.y ?? 0;
    const currentScreenId = getScreenId();

    const resolution = resolveDragEndAcrossScreens({
      currentScreenId,
      curX,
      curY,
      cardW,
      cardH,
      clientX: event.clientX ?? previousState.lastClientX,
      clientY: event.clientY ?? previousState.lastClientY,
      bypassSnap: previousState.lastBypassSnap,
      margins: SNAP_MARGINS,
    });

    const targetScreen = resolution.targetScreen || currentScreenId;
    const finalX = resolution.x;
    const finalY = resolution.y;

    try {
      localStorage.setItem(STORAGE_ACTIVE_SCREEN_KEY, targetScreen);
    } catch (e) {}

    const updatedInstances = (previousState.instances || []).map((inst) => {
      if (!draggingId || inst.id === draggingId) {
        return { ...inst, x: finalX, y: finalY };
      }
      return inst;
    });

    saveInstances(updatedInstances, targetScreen);

    broadcastWidgetMessage('shell', {
      type: 'CROSS_SCREEN_DRAG_PREVIEW',
      preview: null,
    });

    broadcastWidgetMessage('shell', {
      type: 'ACTIVE_SCREEN_CHANGED',
      activeScreen: targetScreen,
      instances: updatedInstances,
      x: finalX,
      y: finalY,
    });

    return {
      ...previousState,
      isDragging: false,
      draggingInstanceId: null,
      crossScreenPreview: null,
      activeScreen: targetScreen,
      instances: updatedInstances,
      x: finalX,
      y: finalY,
    };
  }

  if (event.type === 'MOVE_TO_SCREEN') {
    const targetScreen = resolveActiveScreen(event.screenId || getScreenId());
    try {
      localStorage.setItem(STORAGE_ACTIVE_SCREEN_KEY, targetScreen);
    } catch (e) {}

    const defaultX = SNAP_MARGIN_X;
    const defaultY = SNAP_MARGIN_TOP;
    const finalX = event.x !== undefined ? event.x : defaultX;
    const finalY = event.y !== undefined ? event.y : defaultY;

    const updatedInstances = (previousState.instances || []).map((inst) => ({
      ...inst,
      x: finalX,
      y: finalY,
    }));
    saveInstances(updatedInstances, targetScreen);

    broadcastWidgetMessage('shell', {
      type: 'ACTIVE_SCREEN_CHANGED',
      activeScreen: targetScreen,
      instances: updatedInstances,
      x: finalX,
      y: finalY,
    });

    return {
      ...previousState,
      crossScreenPreview: null,
      activeScreen: targetScreen,
      instances: updatedInstances,
      x: finalX,
      y: finalY,
    };
  }

  if (event.type === 'SYNC_ACTIVE_SCREEN') {
    let updatedInstances = previousState.instances;
    if (Array.isArray(event.instances) && event.instances.length > 0) {
      updatedInstances = event.instances;
    } else if (typeof event.x === 'number' && typeof event.y === 'number') {
      updatedInstances = (previousState.instances || []).map((inst) => ({
        ...inst,
        x: event.x,
        y: event.y,
      }));
    }
    return {
      ...previousState,
      crossScreenPreview: null,
      activeScreen: resolveActiveScreen(event.activeScreen),
      instances: updatedInstances,
      x: event.x !== undefined ? event.x : (updatedInstances[0]?.x ?? previousState.x),
      y: event.y !== undefined ? event.y : (updatedInstances[0]?.y ?? previousState.y),
    };
  }

  if (event.type === 'CROSS_SCREEN_DRAG_PREVIEW') {
    return {
      ...previousState,
      crossScreenPreview: event.preview || null,
    };
  }

  if (event.type === 'TOPOLOGY_UPDATED') {
    const resolved = resolveActiveScreen(previousState.activeScreen, event.topology);
    if (resolved !== previousState.activeScreen) {
      try {
        localStorage.setItem(STORAGE_ACTIVE_SCREEN_KEY, resolved);
      } catch (e) {}
    }
    return {
      ...previousState,
      activeScreen: resolved,
    };
  }

  if (event.type === 'START_RESIZE') {
    return {
      ...previousState,
      isResizing: true,
      resizingInstanceId: event.instanceId,
      resizeStartX: event.clientX,
      resizeStartY: event.clientY,
      startW: event.startW !== undefined ? event.startW : previousState.w,
      startH: event.startH !== undefined ? event.startH : previousState.h,
      startPosX: event.startPosX !== undefined ? event.startPosX : previousState.x,
      startPosY: event.startPosY !== undefined ? event.startPosY : previousState.y,
    };
  }

  if (event.type === 'MOVE_RESIZE' && previousState.isResizing && previousState.resizingInstanceId) {
    const deltaW = event.clientX - previousState.resizeStartX;
    const deltaH = event.clientY - previousState.resizeStartY;

    const currentX = previousState.startPosX !== undefined ? previousState.startPosX : previousState.x;
    const currentY = previousState.startPosY !== undefined ? previousState.startPosY : previousState.y;

    const winW = window.innerWidth || 1920;
    const winH = window.innerHeight || 1080;
    const maxW = Math.max(220, winW - currentX);
    const maxH = Math.max(120, winH - currentY);

    let newW = Math.round(Math.max(220, Math.min(maxW, previousState.startW + deltaW)));
    let newH = Math.round(Math.max(120, Math.min(maxH, previousState.startH + deltaH)));

    if (previousState.enableSnapping !== false && !event.bypassSnap && !event.metaKey) {
      const snapW = winW - currentX - SNAP_MARGIN_X;
      const snapH = winH - currentY - SNAP_MARGIN_BOTTOM;
      if (newW >= snapW - SNAP_THRESHOLD && newW <= snapW + SNAP_EDGE_TOLERANCE && snapW >= 220) {
        newW = snapW;
      }
      if (newH >= snapH - SNAP_THRESHOLD && newH <= snapH + SNAP_EDGE_TOLERANCE && snapH >= 120) {
        newH = snapH;
      }
    }

    const updatedInstances = (previousState.instances || []).map((inst) => {
      if (inst.id === previousState.resizingInstanceId) {
        return { ...inst, w: newW, h: newH };
      }
      return inst;
    });

    return {
      ...previousState,
      instances: updatedInstances,
      w: updatedInstances[0]?.w ?? newW,
      h: updatedInstances[0]?.h ?? newH,
    };
  }

  if (event.type === 'END_RESIZE') {
    saveInstances(previousState.instances, previousState.activeScreen);
    return {
      ...previousState,
      isResizing: false,
      resizingInstanceId: null,
    };
  }

  if (event.type === 'TOGGLE_SNAPPING') {
    const nextVal = previousState.enableSnapping === false ? true : false;
    const screenId = getScreenId();
    try {
      localStorage.setItem(`${STORAGE_SNAP_KEY}_${screenId}`, String(nextVal));
      localStorage.setItem(STORAGE_SNAP_KEY, String(nextVal));
    } catch (e) {}
    return {
      ...previousState,
      enableSnapping: nextVal,
    };
  }

  if (event.type === 'RESET_POSITION') {
    const defaultX = SNAP_MARGIN_X;
    const defaultY = SNAP_MARGIN_TOP;
    const targetId = event.instanceId;
    const updatedInstances = (previousState.instances || []).map((i) => {
      if (i.id === targetId || (!targetId && i.id === (previousState.instances?.[0]?.id || 'default'))) {
        return { ...i, x: defaultX, y: defaultY };
      }
      return i;
    });
    saveInstances(updatedInstances, previousState.activeScreen);
    return {
      ...previousState,
      instances: updatedInstances,
      x: updatedInstances[0]?.x ?? defaultX,
      y: updatedInstances[0]?.y ?? defaultY,
    };
  }

  if (event.type === 'DUPLICATE_WIDGET') {
    const defaultW = configuredCommand ? 520 : 420;
    const defaultH = configuredCommand ? 300 : 220;
    const current = previousState.instances && previousState.instances.length > 0
      ? previousState.instances
      : [{ id: 'default', x: previousState.x || SNAP_MARGIN_X, y: previousState.y || SNAP_MARGIN_TOP, w: previousState.w || defaultW, h: previousState.h || defaultH }];
    const target = current.find((i) => i.id === event.instanceId) || current[current.length - 1];
    const newInst = {
      ...target,
      id: `inst_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      x: (target.x || SNAP_MARGIN_X) + 30,
      y: (target.y || SNAP_MARGIN_TOP) + 30,
    };
    const updatedInstances = [...current, newInst];
    saveInstances(updatedInstances, previousState.activeScreen);
    return {
      ...previousState,
      instances: updatedInstances,
    };
  }

  if (event.type === 'REMOVE_WIDGET') {
    const current = previousState.instances || [];
    if (current.length > 1) {
      const updatedInstances = current.filter((i) => i.id !== event.instanceId);
      saveInstances(updatedInstances, previousState.activeScreen);
      return {
        ...previousState,
        instances: updatedInstances,
      };
    } else {
      const wid = event.widgetId || 'shell-widget-index-jsx';
      run(`osascript -e 'tell application id "tracesOf.Uebersicht" to set hidden of widget id "${wid}" to true'`);
      return previousState;
    }
  }

  if (event.type === 'ORDER_CHANGED') {
    return {
      ...previousState,
      orderTick: Date.now(),
    };
  }

  return previousState;
};

// ANSI color and style parser for rich terminal rendering
function renderAnsiText(raw) {
  if (!raw) return null;

  const cleaned = raw
    .replace(/\r/g, '')
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;]*[A-HJKSTfn]/g, '')
    .replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, '');

  const regex = /\x1b\[([0-9;]*)m/g;
  let lastIndex = 0;
  const elements = [];
  let currentFg = ITERM2_THEME.fg;
  let currentBg = 'transparent';
  let isBold = false;
  let isDim = false;
  let isUnderline = false;
  let match;

  while ((match = regex.exec(cleaned)) !== null) {
    const textChunk = cleaned.slice(lastIndex, match.index);
    if (textChunk) {
      elements.push(
        <span
          key={elements.length}
          style={{
            color: currentFg,
            backgroundColor: currentBg,
            fontWeight: isBold ? '700' : '400',
            textDecoration: isUnderline ? 'underline' : 'none',
            opacity: isDim ? 0.6 : 1,
          }}
        >
          {textChunk}
        </span>
      );
    }

    const codes = match[1] ? match[1].split(';') : ['0'];
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === '0' || code === '') {
        currentFg = ITERM2_THEME.fg;
        currentBg = 'transparent';
        isBold = false;
        isDim = false;
        isUnderline = false;
      } else if (code === '1') {
        isBold = true;
      } else if (code === '2') {
        isDim = true;
      } else if (code === '4') {
        isUnderline = true;
      } else if (code === '22') {
        isBold = false;
        isDim = false;
      } else if (code === '24') {
        isUnderline = false;
      } else if (code === '39') {
        currentFg = ITERM2_THEME.fg;
      } else if (code === '49') {
        currentBg = 'transparent';
      } else if (code === '38' && codes[i + 1] === '5' && codes[i + 2] !== undefined) {
        currentFg = get256Color(parseInt(codes[i + 2], 10));
        i += 2;
      } else if (code === '38' && codes[i + 1] === '2' && codes[i + 4] !== undefined) {
        currentFg = `rgb(${codes[i + 2]}, ${codes[i + 3]}, ${codes[i + 4]})`;
        i += 4;
      } else if (code === '48' && codes[i + 1] === '5' && codes[i + 2] !== undefined) {
        currentBg = get256Color(parseInt(codes[i + 2], 10));
        i += 2;
      } else if (code === '48' && codes[i + 1] === '2' && codes[i + 4] !== undefined) {
        currentBg = `rgb(${codes[i + 2]}, ${codes[i + 3]}, ${codes[i + 4]})`;
        i += 4;
      } else if (FG_MAP[code]) {
        currentFg = FG_MAP[code];
      } else if (BG_MAP[code]) {
        currentBg = BG_MAP[code];
      }
    }

    lastIndex = regex.lastIndex;
  }

  const remaining = cleaned.slice(lastIndex);
  if (remaining) {
    elements.push(
      <span
        key={elements.length}
        style={{
          color: currentFg,
          backgroundColor: currentBg,
          fontWeight: isBold ? '700' : '400',
          textDecoration: isUnderline ? 'underline' : 'none',
          opacity: isDim ? 0.6 : 1,
        }}
      >
        {remaining}
      </span>
    );
  }

  return elements;
}

let currentDispatch = null;

initWidgetDesktopSync({
  widgetName: 'shell',
  helperCommand: `"$HOME/Library/Application Support/Übersicht/widgets/shell.widget/menu_helper" --screens 2>/dev/null || "./shell.widget/menu_helper" --screens 2>/dev/null`,
  run,
  getDispatch: () => currentDispatch,
  onSyncPacket: (data, dispatch) => {
    if (data.type === 'ACTIVE_SCREEN_CHANGED') {
      dispatch({
        type: 'SYNC_ACTIVE_SCREEN',
        activeScreen: data.activeScreen,
        instances: data.instances,
        x: data.x,
        y: data.y,
      });
    } else if (data.type === 'CROSS_SCREEN_DRAG_PREVIEW') {
      dispatch({
        type: 'CROSS_SCREEN_DRAG_PREVIEW',
        preview: data.preview,
      });
    }
  },
});

export const render = (state, dispatch) => {
  currentDispatch = dispatch;
  const currentScreenId = getScreenId();
  const activeScreen = state?.activeScreen || getActiveScreen();
  const isCurrentActive = isScreenActive(currentScreenId, activeScreen);
  const preview = state?.crossScreenPreview;

  if (!isCurrentActive && (!preview || preview.targetScreen !== currentScreenId)) {
    return <div style={{ display: 'none' }} />;
  }

  if (!isCurrentActive && preview && preview.targetScreen === currentScreenId) {
    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          transform: `translate3d(${preview.x}px, ${preview.y}px, 0)`,
          width: `${preview.w}px`,
          height: `${preview.h}px`,
          borderRadius: '16px',
          backgroundColor: ITERM2_THEME.bg,
          backdropFilter: 'blur(24px) saturate(180%)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          border: '1.5px solid rgba(255, 255, 255, 0.28)',
          boxShadow: '0 16px 40px rgba(0, 0, 0, 0.55)',
          zIndex: 9999,
          pointerEvents: 'none',
        }}
      />
    );
  }

  const {
    enableSnapping = true,
    lines = [],
    inputValue = '',
    history = [],
    historyIndex = -1,
    isRunning = false,
  } = state || {};

  const instances = (state && state.instances && state.instances.length > 0)
    ? state.instances
    : [{
        id: 'default',
        x: state?.x ?? SNAP_MARGIN_X,
        y: state?.y ?? SNAP_MARGIN_TOP,
        w: state?.w ?? (configuredCommand ? 520 : 420),
        h: state?.h ?? (configuredCommand ? 300 : 220),
      }];

  const isSingleCommandMode = Boolean(configuredCommand);
  const showPrompt = settings.showPrompt !== undefined ? settings.showPrompt : !isSingleCommandMode;

  const handleRefresh = (e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    const sel = typeof window !== 'undefined' && window.getSelection ? window.getSelection().toString() : '';
    if (e && sel && sel.length > 0) return;
    if (!configuredCommand) return;
    dispatch({ type: 'MANUAL_REFRESH' });
    const fullCmd = formatShellCommand(configuredCommand);
    run(fullCmd)
      .then((output) => {
        if (output && String(output).trim()) {
          dispatch({ type: 'UB/COMMAND_RAN', output: String(output) });
        } else {
          dispatch({ type: 'COMMAND_FINISHED' });
        }
      })
      .catch((err) => {
        const errMsg = typeof err === 'string'
          ? err
          : (err?.message || String(err));
        dispatch({ type: 'UB/COMMAND_RAN', error: errMsg });
      });
  };

  const executeCommand = (cmd) => {
    if (!cmd) return;
    if (cmd.toLowerCase() === 'clear') {
      dispatch({ type: 'CLEAR_LINES' });
      dispatch({ type: 'PUSH_HISTORY', cmd });
      return;
    }

    dispatch({ type: 'COMMAND_START', cmd });

    if (cmd === 'cava' || cmd.startsWith('cava ')) {
      dispatch({
        type: 'COMMAND_OUTPUT',
        lineType: 'output',
        text: 'cava: continuous interactive TUI audio visualizers cannot run in a desktop widget shell.\n' +
              'cava requires a continuous bidirectional terminal session and macOS System Audio Recording permission for AudioTap.\n' +
              'Tip: Use the dedicated cava.widget on your desktop for real-time visualization.',
      });
      return;
    }

    const firstWord = cmd.split(/\s+/)[0];
    if (['vim', 'vi', 'nano', 'emacs'].includes(firstWord)) {
      dispatch({
        type: 'COMMAND_OUTPUT',
        lineType: 'error',
        text: `${firstWord}: interactive editor cannot run in a desktop widget shell.`,
      });
      return;
    }

    if (['less', 'more'].includes(firstWord)) {
      dispatch({
        type: 'COMMAND_OUTPUT',
        lineType: 'error',
        text: `${firstWord}: pager cannot run interactively. Use 'cat' or pipe to 'head'.`,
      });
      return;
    }

    let execCmd = cmd;
    if (cmd === 'top') {
      execCmd = 'top -l 1';
    } else if (/^ping\s+[^-\s]/.test(cmd) && !cmd.includes('-c')) {
      execCmd = `${cmd} -c 4`;
    }

    const fullCmd = formatShellCommand(execCmd);

    const timeoutMs = (settings.timeoutSeconds || 15) * 1000;
    let hasCompleted = false;
    const timer = setTimeout(() => {
      if (!hasCompleted) {
        hasCompleted = true;
        dispatch({
          type: 'COMMAND_OUTPUT',
          lineType: 'error',
          text: `[Process timed out after ${settings.timeoutSeconds || 15}s]`,
        });
      }
    }, timeoutMs);

    run(fullCmd)
      .then((output) => {
        if (hasCompleted) return;
        hasCompleted = true;
        clearTimeout(timer);
        if (output && output.trim()) {
          dispatch({ type: 'COMMAND_OUTPUT', lineType: 'output', text: output });
        } else {
          dispatch({ type: 'COMMAND_FINISHED' });
        }
      })
      .catch((err) => {
        if (hasCompleted) return;
        hasCompleted = true;
        clearTimeout(timer);
        const errMsg = err?.message || String(err);
        dispatch({ type: 'COMMAND_OUTPUT', lineType: 'error', text: errMsg });
      });
  };

  const handleRunAgain = () => {
    if (isSingleCommandMode) {
      handleRefresh();
    } else if (history && history.length > 0) {
      const lastCmd = history[history.length - 1];
      if (lastCmd) {
        executeCommand(lastCmd);
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      const cmd = inputValue.trim();
      if (!cmd) return;
      executeCommand(cmd);
    } else if (e.key === 'Escape' || (e.ctrlKey && e.key === 'c')) {
      e.preventDefault();
      dispatch({ type: 'CANCEL_COMMAND' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const nextIdx = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
        dispatch({ type: 'SET_INPUT', value: history[nextIdx], historyIndex: nextIdx });
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex !== -1) {
        const nextIdx = historyIndex + 1;
        if (nextIdx >= history.length) {
          dispatch({ type: 'SET_INPUT', value: '', historyIndex: -1 });
        } else {
          dispatch({ type: 'SET_INPUT', value: history[nextIdx], historyIndex: nextIdx });
        }
      }
    }
  };

  const promptSymbol = settings.promptSymbol || '❯';
  const promptPlaceholder = settings.placeholder || 'run command...';
  const windowTitle = settings.title || 'zsh';

  return (
    <React.Fragment>
      {instances.map((instance) => {
        const x = instance.x ?? SNAP_MARGIN_X;
        const y = instance.y ?? SNAP_MARGIN_TOP;
        const w = instance.w ?? (configuredCommand ? 520 : 420);
        const h = instance.h ?? (configuredCommand ? 300 : 220);
        const isDragging = state?.isDragging && state?.draggingInstanceId === instance.id;
        const isResizing = state?.isResizing && state?.resizingInstanceId === instance.id;

        const handleMouseDown = (e) => {
          if (e.button !== 0) return;
          if (e.target.closest('input, textarea, button, a, [data-no-drag="true"]')) return;

          const startX = e.clientX;
          const startY = e.clientY;
          const isDragHandle = Boolean(e.target.closest('[data-drag-handle="true"]'));

          const preventSelect = (selEvent) => {
            selEvent.preventDefault();
          };

          let rafId = null;
          let latestMove = null;

          const flushMove = () => {
            rafId = null;
            if (!latestMove) return;
            dispatch({
              type: 'MOVE_DRAG',
              clientX: latestMove.clientX,
              clientY: latestMove.clientY,
              bypassSnap: latestMove.bypassSnap,
            });
          };

          if (e.altKey || isDragHandle) {
            e.preventDefault();
            try {
              if (window.getSelection) {
                window.getSelection().removeAllRanges();
              }
            } catch (err) {}
            window.addEventListener('selectstart', preventSelect, true);
            try {
              document.body.style.userSelect = 'none';
              document.body.style.webkitUserSelect = 'none';
              document.body.style.cursor = 'grabbing';
            } catch (err) {}
            dispatch({
              type: 'START_DRAG',
              instanceId: instance.id,
              clientX: startX,
              clientY: startY,
              startPosX: x,
              startPosY: y,
              w,
              h,
            });

            const onMouseMove = (moveEvent) => {
              moveEvent.preventDefault();
              latestMove = {
                clientX: moveEvent.clientX,
                clientY: moveEvent.clientY,
                bypassSnap: moveEvent.metaKey || moveEvent.altKey || moveEvent.shiftKey,
              };
              if (!rafId) {
                rafId = window.requestAnimationFrame(flushMove);
              }
            };

            const onMouseUp = (upEvent) => {
              if (rafId) {
                window.cancelAnimationFrame(rafId);
                rafId = null;
              }
              window.removeEventListener('selectstart', preventSelect, true);
              try {
                document.body.style.userSelect = '';
                document.body.style.webkitUserSelect = '';
                document.body.style.cursor = '';
                if (window.getSelection) {
                  window.getSelection().removeAllRanges();
                }
              } catch (err) {}
              dispatch({
                type: 'END_DRAG',
                clientX: upEvent.clientX,
                clientY: upEvent.clientY,
              });
              window.removeEventListener('mousemove', onMouseMove);
              window.removeEventListener('mouseup', onMouseUp);
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
            return;
          }

          let dragStarted = false;
          let holdTimer = setTimeout(() => {
            dragStarted = true;
            try {
              if (window.getSelection) {
                window.getSelection().removeAllRanges();
              }
            } catch (err) {}
            window.addEventListener('selectstart', preventSelect, true);
            try {
              document.body.style.userSelect = 'none';
              document.body.style.webkitUserSelect = 'none';
              document.body.style.cursor = 'grabbing';
            } catch (err) {}
            dispatch({
              type: 'START_DRAG',
              instanceId: instance.id,
              clientX: startX,
              clientY: startY,
              startPosX: x,
              startPosY: y,
              w,
              h,
            });
          }, 320);

          const onMouseMove = (moveEvent) => {
            const dist = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
            if (!dragStarted) {
              if (dist > 4) {
                if (holdTimer) {
                  clearTimeout(holdTimer);
                  holdTimer = null;
                }
              }
            } else {
              moveEvent.preventDefault();
              moveEvent.stopPropagation();
              try {
                if (window.getSelection && window.getSelection().rangeCount > 0) {
                  window.getSelection().removeAllRanges();
                }
              } catch (err) {}
              latestMove = {
                clientX: moveEvent.clientX,
                clientY: moveEvent.clientY,
                bypassSnap: moveEvent.metaKey || moveEvent.altKey || moveEvent.shiftKey,
              };
              if (!rafId) {
                rafId = window.requestAnimationFrame(flushMove);
              }
            }
          };

          const onMouseUp = (upEvent) => {
            if (holdTimer) {
              clearTimeout(holdTimer);
              holdTimer = null;
            }
            if (rafId) {
              window.cancelAnimationFrame(rafId);
              rafId = null;
            }
            if (dragStarted) {
              window.removeEventListener('selectstart', preventSelect, true);
              try {
                document.body.style.userSelect = '';
                document.body.style.webkitUserSelect = '';
                document.body.style.cursor = '';
                if (window.getSelection) {
                  window.getSelection().removeAllRanges();
                }
              } catch (err) {}
              dispatch({
                type: 'END_DRAG',
                clientX: upEvent.clientX,
                clientY: upEvent.clientY,
              });
            }
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
          };

          window.addEventListener('mousemove', onMouseMove);
          window.addEventListener('mouseup', onMouseUp);
        };

        const handleResizeStart = (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();

          dispatch({
            type: 'START_RESIZE',
            instanceId: instance.id,
            clientX: e.clientX,
            clientY: e.clientY,
            startW: w,
            startH: h,
            startPosX: x,
            startPosY: y,
          });

          let rafId = null;
          let latestResize = null;

          const flushResize = () => {
            rafId = null;
            if (!latestResize) return;
            dispatch({
              type: 'MOVE_RESIZE',
              clientX: latestResize.clientX,
              clientY: latestResize.clientY,
              bypassSnap: latestResize.bypassSnap,
            });
          };

          const onMouseMove = (moveEvent) => {
            latestResize = {
              clientX: moveEvent.clientX,
              clientY: moveEvent.clientY,
              bypassSnap: moveEvent.metaKey || moveEvent.altKey || moveEvent.shiftKey,
            };
            if (!rafId) {
              rafId = window.requestAnimationFrame(flushResize);
            }
          };

          const onMouseUp = () => {
            if (rafId) {
              window.cancelAnimationFrame(rafId);
              rafId = null;
            }
            dispatch({ type: 'END_RESIZE' });
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
          };

          window.addEventListener('mousemove', onMouseMove);
          window.addEventListener('mouseup', onMouseUp);
        };

        const handleContextMenu = (e) => {
          e.preventDefault();
          e.stopPropagation();

          const canRerun = isSingleCommandMode ? Boolean(configuredCommand) : Boolean(history && history.length > 0);
          const payload = JSON.stringify({
            instanceId: instance.id,
            enableSnapping: enableSnapping !== false,
            canRerun,
            rerunTitle: 'Run Again',
            screenId: currentScreenId,
            x: Math.round(x),
            y: Math.round(y),
          });

          const helperPath = '$HOME/Library/Application Support/Übersicht/widgets/shell.widget/menu_helper';
          const fallbackPath = './shell.widget/menu_helper';
          const escapedPayload = payload.replace(/'/g, "'\\''");
          const cmd = `"${helperPath}" '${escapedPayload}' 2>/dev/null || "${fallbackPath}" '${escapedPayload}' 2>/dev/null`;

          run(cmd, (err, output) => {
            if (err || !output) return;
            try {
              const res = JSON.parse(output.trim());
              if (!res || !res.action) return;

              if (res.action === 'RUN_AGAIN' || res.action === 'RERUN_COMMAND') {
                handleRunAgain();
              } else if (res.action === 'TOGGLE_SNAPPING') {
                dispatch({ type: 'TOGGLE_SNAPPING' });
              } else if (res.action === 'RESET_POSITION') {
                dispatch({ type: 'RESET_POSITION', instanceId: res.instanceId || instance.id });
              } else if (res.action === 'RELOAD_WIDGET') {
                const wid = res.widgetId || 'shell-widget-index-jsx';
                run(`osascript -e 'tell application id "tracesOf.Uebersicht" to reload widget id "${wid}"' 2>/dev/null || osascript -e 'tell application id "tracesOf.Uebersicht" to refresh'`);
              } else if (res.action === 'REMOVE_WIDGET') {
                dispatch({ type: 'REMOVE_WIDGET', instanceId: res.instanceId || instance.id, widgetId: res.widgetId || 'shell-widget-index-jsx' });
              } else if (res.action === 'DUPLICATE_WIDGET') {
                dispatch({ type: 'DUPLICATE_WIDGET', instanceId: res.instanceId || instance.id });
              } else if (res.action === 'MOVE_TO_SCREEN') {
                dispatch({ type: 'MOVE_TO_SCREEN', screenId: res.screenId, instanceId: res.instanceId || instance.id });
              } else if (res.action === 'ORDER_FRONT' || res.action === 'ORDER_FORWARD' || res.action === 'ORDER_BACKWARD' || res.action === 'ORDER_BACK') {
                reorderWidget('shell', res.action);
                dispatch({ type: 'ORDER_CHANGED' });
              }
            } catch (parseErr) {}
          });
        };

        const positionStyle = {
          position: 'fixed',
          top: 0,
          left: 0,
          transform: `translate3d(${x}px, ${y}px, 0)`,
          willChange: isDragging || isResizing ? 'transform, width, height' : 'auto',
          width: `${w}px`,
          height: `${h}px`,
          zIndex: isDragging ? 9999 : getWidgetZIndex('shell'),
          cursor: isDragging ? 'grabbing' : isResizing ? 'se-resize' : 'default',
          boxSizing: 'border-box',
        };

        return (
          <div
            key={instance.id}
            className={isDragging ? 'shell-dragging' : ''}
            style={{
              ...positionStyle,
              userSelect: isDragging ? 'none' : 'text',
              WebkitUserSelect: isDragging ? 'none' : 'text',
            }}
            onMouseDown={handleMouseDown}
            onContextMenu={handleContextMenu}
            tabIndex={0}
            onKeyDown={(e) => {
              if ((e.key === 'Escape' || (e.ctrlKey && e.key === 'c')) && isRunning) {
                e.preventDefault();
                dispatch({ type: 'CANCEL_COMMAND' });
              }
            }}
          >
            <div
              style={windowStyle}
              onDoubleClick={isSingleCommandMode ? handleRefresh : undefined}
            >
              {settings.showTitleBar && (
                <div style={titleBarStyle} data-drag-handle="true">
                  <div style={trafficLightsStyle}>
                    <span
                      style={{ ...dotStyle, backgroundColor: '#ff5f56' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        dispatch({ type: 'CLEAR_LINES' });
                      }}
                      title="Clear terminal"
                      data-no-drag="true"
                    />
                    <span style={{ ...dotStyle, backgroundColor: '#ffbd2e' }} />
                    <span style={{ ...dotStyle, backgroundColor: '#27c93f' }} />
                  </div>
                  <div style={titleTextStyle}>{windowTitle}</div>
                  <div style={{ width: '48px' }} />
                </div>
              )}

              <style dangerouslySetInnerHTML={{ __html: `
                .shell-dragging,
                .shell-dragging * {
                  user-select: none !important;
                  -webkit-user-select: none !important;
                  cursor: grabbing !important;
                }

                .shell-terminal-scroll,
                .shell-terminal-scroll pre,
                .shell-terminal-scroll span,
                .shell-terminal-scroll div {
                  cursor: default;
                }

                .shell-terminal-scroll,
                .shell-terminal-scroll * {
                  color-scheme: dark !important;
                  scrollbar-width: auto !important;
                  scrollbar-color: auto !important;
                }
                .shell-terminal-scroll::-webkit-scrollbar,
                .shell-terminal-scroll *::-webkit-scrollbar {
                  width: 4px !important;
                  height: 4px !important;
                  background: transparent !important;
                  background-color: rgba(0, 0, 0, 0) !important;
                }
                .shell-terminal-scroll::-webkit-scrollbar-track,
                .shell-terminal-scroll *::-webkit-scrollbar-track,
                .shell-terminal-scroll::-webkit-scrollbar-track-piece,
                .shell-terminal-scroll *::-webkit-scrollbar-track-piece {
                  background: transparent !important;
                  background-color: rgba(0, 0, 0, 0) !important;
                  border: none !important;
                  box-shadow: none !important;
                }
                .shell-terminal-scroll::-webkit-scrollbar-thumb,
                .shell-terminal-scroll *::-webkit-scrollbar-thumb {
                  background: rgba(255, 255, 255, 0.18) !important;
                  background-color: rgba(255, 255, 255, 0.18) !important;
                  border-radius: 4px !important;
                  border: none !important;
                  box-shadow: none !important;
                }
                .shell-terminal-scroll::-webkit-scrollbar-thumb:hover,
                .shell-terminal-scroll *::-webkit-scrollbar-thumb:hover {
                  background: rgba(255, 255, 255, 0.35) !important;
                  background-color: rgba(255, 255, 255, 0.35) !important;
                }
                .shell-terminal-scroll::-webkit-scrollbar-corner,
                .shell-terminal-scroll *::-webkit-scrollbar-corner,
                .shell-terminal-scroll::-webkit-resizer,
                .shell-terminal-scroll *::-webkit-resizer {
                  background: transparent !important;
                  background-color: rgba(0, 0, 0, 0) !important;
                  border: none !important;
                  box-shadow: none !important;
                }
                .shell-terminal-scroll::-webkit-scrollbar-button,
                .shell-terminal-scroll *::-webkit-scrollbar-button {
                  display: none !important;
                  width: 0 !important;
                  height: 0 !important;
                }
              ` }} />

              <div
                className="shell-terminal-scroll"
                ref={(el) => {
                  if (el) {
                    el.scrollTop = el.scrollHeight;
                  }
                }}
                style={{ ...terminalBodyStyle, cursor: isDragging ? 'grabbing' : 'default' }}
                onClick={() => {
                  if (showPrompt) {
                    const sel = typeof window !== 'undefined' && window.getSelection ? window.getSelection().toString() : '';
                    if (sel && sel.length > 0) return;
                    const inputEl = document.getElementById(`shell-widget-input-${instance.id}`);
                    if (inputEl) inputEl.focus();
                  }
                }}
              >
                {lines.map((line, idx) => {
                  const lineText = typeof line?.text === 'string'
                    ? line.text
                    : (line?.text?.message || String(line?.text || ''));
                  return (
                    <div key={idx} style={lineStyle}>
                      {line.type === 'command' ? (
                        <span>
                          <span style={{ color: ITERM2_THEME.yellow, marginRight: '6px', fontWeight: '700' }}>{promptSymbol}</span>
                          <span style={{ color: ITERM2_THEME.brightWhite }}>{lineText}</span>
                        </span>
                      ) : line.type === 'error' ? (
                        <span style={{ color: ITERM2_THEME.red }}>{lineText}</span>
                      ) : (
                        <pre style={preStyle}>{renderAnsiText(lineText)}</pre>
                      )}
                    </div>
                  );
                })}

                {isSingleCommandMode && lines.length === 0 && (
                  <div style={runningRowStyle}>
                    <span style={runningDotStyle} />
                    <span style={runningTextStyle}>loading {configuredCommand}...</span>
                  </div>
                )}

                {showPrompt && (
                  isRunning ? (
                    <div style={runningRowStyle}>
                      <span style={runningDotStyle} />
                      <span style={runningTextStyle}>running...</span>
                      <span
                        style={abortButtonStyle}
                        onClick={(e) => {
                          e.stopPropagation();
                          dispatch({ type: 'CANCEL_COMMAND' });
                        }}
                        title="Cancel command (Ctrl+C / Esc)"
                        data-no-drag="true"
                      >
                        ✕ cancel
                      </span>
                    </div>
                  ) : (
                    <div style={promptRowStyle}>
                      <span style={promptSymbolStyle}>{promptSymbol}</span>
                      <input
                        id={`shell-widget-input-${instance.id}`}
                        type="text"
                        value={inputValue}
                        onChange={(e) => dispatch({ type: 'SET_INPUT', value: e.target.value })}
                        onKeyDown={handleKeyDown}
                        placeholder={promptPlaceholder}
                        style={inputStyle}
                        data-no-drag="true"
                        autoFocus={true}
                      />
                    </div>
                  )
                )}
              </div>

              <div
                data-no-drag="true"
                style={resizeHandleStyle}
                onMouseDown={handleResizeStart}
                title="Drag to resize"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <circle cx="8" cy="8" r="1" fill="rgba(255,255,255,0.35)" />
                  <circle cx="8" cy="4" r="1" fill="rgba(255,255,255,0.35)" />
                  <circle cx="4" cy="8" r="1" fill="rgba(255,255,255,0.35)" />
                </svg>
              </div>
            </div>
          </div>
        );
      })}
    </React.Fragment>
  );
};

export const className = `
  color-scheme: dark;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
  color: ${ITERM2_THEME.fg};
  user-select: text;
  -webkit-user-select: text;
  cursor: default;

  &, & * {
    cursor: default;
  }

  input {
    user-select: text;
    -webkit-user-select: text;
    cursor: text !important;
  }

  ::selection {
    background: ${ITERM2_THEME.selectionBg};
    color: ${ITERM2_THEME.selectionFg};
  }

  * {
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.16) transparent;
  }
  *::-webkit-scrollbar {
    width: 5px;
    height: 5px;
    background: transparent !important;
  }
  *::-webkit-scrollbar-track {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
  }
  *::-webkit-scrollbar-track-piece {
    background: transparent !important;
    border: none !important;
  }
  *::-webkit-scrollbar-thumb {
    background-color: rgba(255, 255, 255, 0.16) !important;
    border-radius: 999px !important;
    border: none !important;
    box-shadow: none !important;
  }
  *::-webkit-scrollbar-thumb:hover {
    background-color: rgba(255, 255, 255, 0.30) !important;
  }
  *::-webkit-scrollbar-corner {
    background: transparent !important;
    display: none !important;
  }
  *::-webkit-resizer {
    background: transparent !important;
    display: none !important;
  }
  *::-webkit-scrollbar-button {
    display: none !important;
    width: 0 !important;
    height: 0 !important;
  }
`;

const windowStyle = {
  position: 'relative',
  width: '100%',
  height: '100%',
  backgroundColor: ITERM2_THEME.bg,
  backdropFilter: 'blur(28px) saturate(180%)',
  WebkitBackdropFilter: 'blur(28px) saturate(180%)',
  borderRadius: '16px',
  boxShadow: '0 16px 40px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.3)',
  border: `1px solid ${ITERM2_THEME.cardBorder}`,
  boxSizing: 'border-box',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
};

const titleBarStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px',
  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
  backgroundColor: 'rgba(0, 0, 0, 0.15)',
  cursor: 'grab',
  flexShrink: 0,
  userSelect: 'none',
  WebkitUserSelect: 'none',
};

const trafficLightsStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  width: '48px',
};

const dotStyle = {
  width: '9px',
  height: '9px',
  borderRadius: '50%',
  display: 'inline-block',
  cursor: 'pointer',
};

const titleTextStyle = {
  fontSize: '11px',
  fontWeight: '600',
  color: 'rgba(252, 232, 195, 0.70)',
  letterSpacing: '0.2px',
};

const terminalBodyStyle = {
  flex: 1,
  padding: '12px 14px',
  overflowY: 'auto',
  overflowX: 'auto',
  fontFamily: settings.fontFamily || '"SF Mono", "JetBrains Mono", "Fira Code", Menlo, Monaco, Consolas, monospace',
  fontSize: typeof settings.fontSize === 'number' ? `${settings.fontSize}px` : (settings.fontSize || '11px'),
  lineHeight: settings.lineHeight || '1.35',
  color: ITERM2_THEME.fg,
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  boxSizing: 'border-box',
  backgroundColor: 'transparent',
};

const lineStyle = {
  wordBreak: 'break-word',
  whiteSpace: 'pre-wrap',
};

const preStyle = {
  margin: 0,
  fontFamily: 'inherit',
  fontSize: 'inherit',
  lineHeight: 'inherit',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  color: ITERM2_THEME.fg,
};

const promptRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  marginTop: '2px',
};

const promptSymbolStyle = {
  color: ITERM2_THEME.green,
  fontWeight: '700',
  userSelect: 'none',
  WebkitUserSelect: 'none',
};

const inputStyle = {
  flex: 1,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  color: ITERM2_THEME.brightWhite,
  caretColor: ITERM2_THEME.cursor,
  fontFamily: 'inherit',
  fontSize: 'inherit',
  padding: 0,
  margin: 0,
};

const runningRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginTop: '2px',
  padding: '2px 0',
};

const runningDotStyle = {
  width: '7px',
  height: '7px',
  borderRadius: '50%',
  backgroundColor: ITERM2_THEME.yellow,
  boxShadow: `0 0 8px ${ITERM2_THEME.yellow}`,
  display: 'inline-block',
};

const runningTextStyle = {
  color: ITERM2_THEME.yellow,
  fontSize: '11px',
  fontStyle: 'italic',
  opacity: 0.9,
  userSelect: 'none',
  WebkitUserSelect: 'none',
};

const abortButtonStyle = {
  marginLeft: 'auto',
  fontSize: '10px',
  color: ITERM2_THEME.red,
  backgroundColor: 'rgba(247, 83, 65, 0.14)',
  border: '1px solid rgba(247, 83, 65, 0.35)',
  borderRadius: '6px',
  padding: '1px 7px',
  cursor: 'pointer',
  fontWeight: '600',
  userSelect: 'none',
  WebkitUserSelect: 'none',
};

const resizeHandleStyle = {
  position: 'absolute',
  bottom: 0,
  right: 0,
  width: '18px',
  height: '18px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'se-resize',
  zIndex: 10,
  userSelect: 'none',
  WebkitUserSelect: 'none',
};
