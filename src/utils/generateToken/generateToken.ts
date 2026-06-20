import jwt from "jsonwebtoken";

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}

export const generateToken = (payload: any) => {
  return jwt.sign(
    payload,

    process.env.JWT_SECRET as string,

    {
      expiresIn: "7d",
    },
  );
};
