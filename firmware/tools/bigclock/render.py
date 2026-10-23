import re
from PIL import Image, ImageDraw, ImageFont
from font import *
src=open("/workspace/LED_Matrix_Aura/firmware/.pio/libdeps/adafruit_matrixportal_esp32s3/Adafruit GFX Library/glcdfont.c").read()
body=src[src.index('{',src.index('font[]')):]
B=[int(x,16) for x in re.findall(r'0x[0-9A-Fa-f]{2}',body)]
def text(px,s,x,y,col):
    for ch in s:
        o=ord(ch)*5
        for cx in range(5):
            b=B[o+cx]
            for ry in range(8):
                if b>>ry&1: px[(x+cx,y+ry)]=col
        x+=6
def frame(ci,h24,hh,mm,wd,mo,dd):
    rgb=COLORS[ci][1]; dim=tuple(v*42//100 for v in rgb)
    px={}
    txt,ap,x,_=clock_layout(h24,hh,mm)
    for ch in txt:
        if ch==':':
            for yy in list(range(TOP+9,TOP+13))+list(range(TOP+21,TOP+25)):
                for xx in range(x,x+COLW): px[(xx,yy)]=rgb
            x+=COLW+GAP; continue
        g=FONT[ch]
        for yy in range(H):
            for xx in range(W):
                if g[yy][xx]: px[(x+xx,TOP+yy)]=rgb
        x+=W+GAP
    if ap: text(px,ap,x,TOP,rgb)
    d=f"{wd} {mo} {dd}"; text(px,d,max(0,(128-len(d)*6)//2),DATE_Y,dim)
    return px
SC=5
def panel(px):
    im=Image.new("RGB",(128*SC+16,64*SC+16),(12,12,14)); dr=ImageDraw.Draw(im)
    for y in range(64):
        for x in range(128):
            c=px.get((x,y),(28,28,30)); X,Y=8+x*SC,8+y*SC
            dr.ellipse([X+0.5,Y+0.5,X+SC-1,Y+SC-1],fill=c)
    return im
F=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",16)
shots=[(0,False,17,5,"White · 5:05 PM (12h)"),(4,False,9,41,"Amber · 9:41 AM"),(6,False,12,30,"Cyan · 12:30 PM"),(2,True,21,47,"Red · 21:47 (24h option)")]
ims=[]
for ci,h24,hh,mm,lab in shots:
    p=panel(frame(ci,h24,hh,mm,"FRI","OCT",23))
    t=Image.new("RGB",(p.width,p.height+28),(12,12,14)); t.paste(p,(0,28))
    ImageDraw.Draw(t).text((10,5),lab,fill=(220,220,220),font=F); ims.append(t)
w,h=ims[0].size; out=Image.new("RGB",(w*2+10,h*2+10),(0,0,0))
for i,im in enumerate(ims): out.paste(im,((i%2)*(w+10),(i//2)*(h+10)))
out.save("/workspace/previews/bigclock.png"); print(out.size)
