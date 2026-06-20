import jwt from "jsonwebtoken";

export const authMiddleware = (req: any, res: any, next: any) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader.split(" ")[0] !== "Bearer") {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const token = authHeader.split(" ")[1];
    if (!token) return res.status(401).json({ success: false, message: "Unauthorized" });
    const decoded: any = jwt.verify(token, process.env.JWT_SECRET!);
    req.user = decoded;
    next();
  } catch (error: any) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, message: "Token expired, please login again" });
    }
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
};
