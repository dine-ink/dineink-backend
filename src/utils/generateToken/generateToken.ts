import jwt from "jsonwebtoken";

export const generateToken = (payload: any) => {
  return jwt.sign(
    payload,

    process.env.JWT_SECRET as string,

    {
      expiresIn: "7d",
    },
  );
};
