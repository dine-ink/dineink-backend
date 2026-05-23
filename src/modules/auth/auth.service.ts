import bcrypt from "bcryptjs";
import prisma from "../../config/prisma";
import { generateToken } from "../../utils/generateToken/generateToken";

export const loginUser = async (identifier: string, password: string) => {
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        {
          email: identifier,
        },
        {
          phone: identifier,
        },
      ],
    },

    include: {
      restaurant: true,
      branch: true,
    },
  });

  // USER NOT FOUND

  if (!user) {
    throw new Error("Invalid credentials");
  }

  // USER DELETED / INACTIVE

  if (user.isDeleted || !user.isActive) {
    throw new Error("Account is inactive");
  }

  // LOGIN ACCESS CHECK

  if (user.role !== "OWNER" && !user.hasLogin) {
    throw new Error("Login access denied");
  }

  // PASSWORD CHECK

  const isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    throw new Error("Invalid credentials");
  }

  // TOKEN

  const token = generateToken({
    id: user.id,
    email: user.email,
    role: user.role,
    restaurantId: user.restaurantId,
    branchId: user.branchId,
  });

  // REMOVE PASSWORD

  const { password: _, ...safeUser } = user;

  // BRANCHES

  const branches = user.restaurantId
    ? await prisma.branch.findMany({
        where: {
          restaurantId: user.restaurantId,
          isDeleted: false,
          isActive: true,
        },

        orderBy: {
          createdAt: "asc",
        },
      })
    : [];

  return {
    token,
    user: safeUser,
    restaurant: safeUser.restaurant,
    branches,
  };
};

export const signupUser = async ({
  name,
  email,
  phone,
  password,
}: {
  name: string;
  email: string;
  phone?: string;
  password: string;
}) => {
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        {
          email,
        },
        {
          phone,
        },
      ],
    },
  });

  if (existingUser) {
    throw new Error("User already exists");
  }
  if (password.length < 6) {
    throw new Error("Password must be at least 6 characters");
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      name,
      email,
      phone,
      password: hashedPassword,
      role: "OWNER",
    },
  });

  const token = generateToken({
    id: user.id,
    email: user.email,
    role: user.role,
    restaurantId: user.restaurantId,
    branchId: user.branchId,
  });
  const { password: _, ...safeUser } = user;
  return {
    token,
    user: safeUser,
  };
};

export const changePasswordService = async (
  userId: number,
  currentPassword: string,
  newPassword: string,
) => {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }
  const isValid = await bcrypt.compare(currentPassword, user.password);
  if (!isValid) {
    throw new Error("Current password is incorrect");
  }
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: {
      id: userId,
    },
    data: {
      password: hashedPassword,
    },
  });
  return true;
};
