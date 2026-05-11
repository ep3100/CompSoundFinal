/* tonnetz.js — canvas renderer for the tonnetz lattice */

import { NOTE_NAMES, BLACK_KEYS } from './theory.js';


/* ── constants ── */

/* colors — match style.css vars but hardcoded for canvas */
const COLOR = {
  bg:          "#1a1a1f",
  node:        "#24242b",
  nodeBorder:  "#2e2e38",
  text:        "#7a7890",
  textBright:  "#e8e6f0",
  original:    "#7c6ff7",   /* purple */
  mirror:      "#3dcfab",   /* teal */
  axis:        "#e05c5c",   /* red dashed axis line */
  tonic:       "#f0a030",   /* amber for tonic node */
  edge:        "#2e2e38",   /* grid lines */
};

/* tonnetz layout — these control the shape of the grid */
const STEP_X  = 70;    /* horizontal distance between nodes (perfect fifth) */
const STEP_Y  = 50;    /* vertical distance between rows */
const ROWS    = 4;     /* how many rows of nodes to draw */
const COLS    = 13;    /* how many columns — extra so screen always fills */
const NODE_R  = 18;    /* node circle radius */


/* ── tonnetz structure ── */

/* in a standard tonnetz:
   moving right   = +7 semitones (perfect fifth)
   moving up-left = +3 semitones (minor third)
   moving up-right= +4 semitones (major third)

   we generate node positions and their pitch class
   by anchoring row 0 at pitch 0 (C) and deriving everything */

/* build a flat list of all node positions + pitch classes */
function buildNodes(offsetX, offsetY) {
  const nodes = [];

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      /* stagger every other row to get the hex feel */
      const x = offsetX + col * STEP_X + (row % 2) * (STEP_X / 2);
      const y = offsetY + row * STEP_Y;

      /* pitch class: each step right = +7, each step up = +3
         row 0 starts at 0 (C), row 1 starts at +3 (Eb), etc. */
      const pc = ((col * 7) + (row * 3)) % 12;

      nodes.push({ x, y, pc, row, col });
    }
  }

  return nodes;
}

/* build edges — connect nodes that are a perfect fifth, major third,
   or minor third apart (i.e. adjacent on the tonnetz) */
function buildEdges(nodes) {
  const edges = [];
  const map   = new Map();

  /* index nodes by row,col for fast lookup */
  nodes.forEach(n => map.set(`${n.row},${n.col}`, n));

  nodes.forEach(n => {
    /* right neighbor = perfect fifth */
    const right = map.get(`${n.row},${n.col + 1}`);
    if (right) edges.push([n, right]);

    /* down-right neighbor = major third */
    const downRight = map.get(`${n.row + 1},${n.col}`);
    if (downRight) edges.push([n, downRight]);

    /* down-left neighbor = minor third */
    const downLeft = map.get(`${n.row + 1},${n.col - 1}`);
    if (downLeft) edges.push([n, downLeft]);
  });

  return edges;
}


/* ── renderer ── */

export class TonnetzRenderer {
  constructor(canvasEl) {
    this.canvas  = canvasEl;
    this.ctx     = canvasEl.getContext("2d");

    /* state passed in from app.js */
    this.tonic        = 0;     /* current key tonic pitch class */
    this.axis         = 7;     /* reflection axis pitch class */
    this.highlighted  = [];    /* original chord pitch classes */
    this.mirrored     = [];    /* mirror chord pitch classes */

    this._resize();
    window.addEventListener("resize", () => this._resize());
  }

  /* match canvas pixel size to its css display size
     without this it'll look blurry on retina screens */
  _resize() {
    const dpr  = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();

    /* if canvas has no size yet (not laid out), try again next frame */
    if (rect.width === 0 || rect.height === 0) {
      requestAnimationFrame(() => this._resize());
      return;
    }

    /* reset transform before re-scaling — avoids compounding dpr on repeated calls */
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);

    this.canvas.width  = rect.width  * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.cssW = rect.width;
    this.cssH = rect.height;
    this.draw();
  }

  /* update which chords to highlight and redraw */
  update({ tonic, axis, highlighted = [], mirrored = [] }) {
    this.tonic       = tonic;
    this.axis        = axis;
    this.highlighted = highlighted;
    this.mirrored    = mirrored;
    this.draw();
  }

  draw() {
    const { ctx, cssW, cssH } = this;
    if (!cssW || !cssH) return;

    /* center the grid vertically, nudge left so it fills well */
    const offsetX = 40;
    const offsetY = (cssH - (ROWS - 1) * STEP_Y) / 2;

    const nodes = buildNodes(offsetX, offsetY);
    const edges = buildEdges(nodes);

    /* clear */
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = COLOR.bg;
    ctx.fillRect(0, 0, cssW, cssH);

    /* draw edges first so nodes sit on top */
    this._drawEdges(edges);

    /* draw axis line */
    this._drawAxis(nodes);

    /* draw nodes */
    nodes.forEach(n => this._drawNode(n));
  }

  _drawEdges(edges) {
    const { ctx } = this;
    ctx.strokeStyle = COLOR.edge;
    ctx.lineWidth   = 0.5;

    edges.forEach(([a, b]) => {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });
  }

  /* axis is a vertical dashed line at the x position of axis pitch class nodes
     find all nodes with pc === axis and draw a line through them */
  _drawAxis(nodes) {
    const { ctx, cssH } = this;
    const axisNodes = nodes.filter(n => n.pc === this.axis);
    if (axisNodes.length === 0) return;

    /* average x of axis nodes */
    const avgX = axisNodes.reduce((s, n) => s + n.x, 0) / axisNodes.length;

    ctx.save();
    ctx.strokeStyle    = COLOR.axis;
    ctx.lineWidth      = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.globalAlpha    = 0.6;
    ctx.beginPath();
    ctx.moveTo(avgX, 0);
    ctx.lineTo(avgX, cssH);
    ctx.stroke();
    ctx.restore();
  }

  _drawNode(n) {
    const { ctx } = this;
    const isOriginal = this.highlighted.includes(n.pc);
    const isMirror   = this.mirrored.includes(n.pc);
    const isTonic    = n.pc === this.tonic;
    const isAxis     = n.pc === this.axis;

    /* pick fill color based on state */
    let fill   = COLOR.node;
    let border = COLOR.nodeBorder;
    let label  = COLOR.text;
    let glow   = null;

    if (isOriginal && isMirror) {
      /* shared note between original + mirror — blend colors */
      fill   = "#5a9e90";
      border = "#3dcfab";
      label  = COLOR.textBright;
    } else if (isOriginal) {
      fill   = "#2e2a50";
      border = COLOR.original;
      label  = COLOR.original;
      glow   = COLOR.original;
    } else if (isMirror) {
      fill   = "#1a3830";
      border = COLOR.mirror;
      label  = COLOR.mirror;
      glow   = COLOR.mirror;
    } else if (isTonic) {
      fill   = "#3a2e10";
      border = COLOR.tonic;
      label  = COLOR.tonic;
    } else if (isAxis) {
      /* axis node gets a faint red tint */
      border = COLOR.axis;
      label  = COLOR.axis;
    }

    /* glow effect for highlighted nodes */
    if (glow) {
      ctx.save();
      ctx.shadowColor = glow;
      ctx.shadowBlur  = 12;
      ctx.beginPath();
      ctx.arc(n.x, n.y, NODE_R, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();
    }

    /* node circle */
    ctx.beginPath();
    ctx.arc(n.x, n.y, NODE_R, 0, Math.PI * 2);
    ctx.fillStyle   = fill;
    ctx.strokeStyle = border;
    ctx.lineWidth   = isOriginal || isMirror ? 1.5 : 0.5;
    ctx.fill();
    ctx.stroke();

    /* note name label */
    ctx.fillStyle  = label;
    ctx.font       = `${isOriginal || isMirror ? 500 : 400} 11px "Inter", system-ui, sans-serif`;
    ctx.textAlign  = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(NOTE_NAMES[n.pc], n.x, n.y);
  }
}