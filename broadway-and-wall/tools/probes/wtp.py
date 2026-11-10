import re,sys,math
for f in sys.argv[1:]:
  R=[]
  for l in open(f):
    m=re.match(r"y(\d+) vac ([\d.]+) M ([\d.]+) lettings ([\d.]+).*rent ([\d.]+)",l)
    if m: R.append(tuple(float(x) for x in m.groups()))
  def reg(X,Y):
    n=len(X);mx=sum(X)/n;my=sum(Y)/n
    return sum((a-mx)*(b-my) for a,b in zip(X,Y))/sum((a-mx)**2 for a in X)
  R=[r for r in R if r[0]>=6]
  dl=[100*math.log(R[i+1][4]/R[i][4]) for i in range(len(R)-1)]
  print(f.split("/")[-1], "lagged WT", round(reg([r[1] for r in R[:-1]],dl),2), " same-yr WT", round(reg([r[1] for r in R[1:]],dl),2),
   " dlogrent on dvac", round(reg([R[i+1][1]-R[i][1] for i in range(len(R)-1)],dl),2), " step ln(24/M)/4.5 lagged", round(reg([100*math.log(24/r[2])/4.5 for r in R[:-1]],dl),2), "same", round(reg([100*math.log(24/r[2])/4.5 for r in R[1:]],dl),2))
