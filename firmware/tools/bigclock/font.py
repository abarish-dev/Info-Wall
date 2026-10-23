W,H,S=20,34,4
M=(H-S)//2  # 15
def blank(): return [[0]*W for _ in range(H)]
def rect(g,x0,y0,x1,y1):
    for y in range(y0,y1+1):
        for x in range(x0,x1+1): g[y][x]=1
SEG={'a':(0,0,W-1,S-1),'d':(0,H-S,W-1,H-1),'g':(0,M,W-1,M+S-1),
     'f':(0,0,S-1,M+S-1),'b':(W-S,0,W-1,M+S-1),'e':(0,M,S-1,H-1),'c':(W-S,M,W-1,H-1)}
DIG={'0':'abcdef','2':'abged','3':'abgcd','4':'fgbc','5':'afgcd','6':'afgedc','7':'abc','8':'abcdefg','9':'abcdfg'}
def round_corners(g):
    for y in range(H):
        for x in range(W):
            if not g[y][x]: continue
            n=lambda xx,yy: 0<=xx<W and 0<=yy<H and g[yy][xx]
            # outer convex corner: two orthogonal empty neighbours
            for dx,dy in ((-1,-1),(1,-1),(-1,1),(1,1)):
                if not n(x+dx,y) and not n(x,y+dy) and n(x-dx,y) and n(x,y-dy) and n(x-dx,y-dy) and n(x-2*dx,y) and n(x,y-2*dy):
                    g[y][x]=2
    for y in range(H):
        for x in range(W):
            if g[y][x]==2: g[y][x]=0
def glyph(c):
    g=blank()
    if c=='1':
        rect(g,11,0,14,H-1)               # stem
        rect(g,6,0,10,S-1)                # flag
        g[0][6]=0
    elif c=='7':
        rect(g,*SEG['a']); rect(g,W-S,0,W-1,H-1)
    else:
        for s in DIG[c]: rect(g,*SEG[s])
    for y,x in ((0,0),(0,W-1),(H-1,0),(H-1,W-1)): g[y][x]=0
    return g
FONT={c:glyph(c) for c in '0123456789'}
COLORS=[("white",(255,255,255)),("warm",(255,200,130)),("red",(255,30,20)),("orange",(255,110,0)),
        ("amber",(255,176,0)),("green",(40,255,80)),("cyan",(0,230,255)),("blue",(40,90,255)),
        ("purple",(170,60,255)),("pink",(255,70,170))]
DIM=0.42
def layout(h24, hh, mm):
    """Return list of (kind, x, y, data). Mirrors drawBigClock()."""
    txt = (f"{hh:02d}" if h24 else str(hh)) + ":" + f"{mm:02d}"
    GAP, CW = 3, 4
    w = sum(CW+4 if ch==':' else W+GAP for ch in txt) - GAP
    # ':' occupies 2px gap + 4px dot + 2px gap; preceding digit gap already 3 -> handled below
    amw = 0 if h24 else 12
    total = w + (amw+2 if amw else 0)
    x = (128-total)//2
    return txt, x, w

GAP=3; COLW=4; TOP=5; DATE_Y=47
def adv(ch): return COLW if ch==':' else W
def clock_layout(h24,hour,minute):
    if h24: txt=f"{hour:02d}:{minute:02d}"; ap=""
    else:
        h=hour%12 or 12; txt=f"{h}:{minute:02d}"; ap="AM" if hour<12 else "PM"
    w=sum(adv(c) for c in txt)+GAP*(len(txt)-1)
    total=w+(GAP+11 if ap else 0)
    return txt,ap,(128-total)//2,w
