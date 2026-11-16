import { getAddress, ZeroAddress } from "ethers";

export function deploymentRoles(deployerAddress: string, moderatorAddress?: string) {
  const admin = getAddress(deployerAddress);
  let moderator: string;
  try {
    moderator = getAddress(moderatorAddress?.trim() || admin);
  } catch {
    throw new Error("MODERATOR_ADDRESS має бути коректною Ethereum-адресою");
  }
  if (moderator === ZeroAddress) throw new Error("MODERATOR_ADDRESS не може бути нульовою адресою");
  return { admin, moderator };
}
