import Image from "next/image";
import Link from "next/link";
import logo from "../../../public/Modern ARKNP NFC Logo.png";

export function Brand({ href = "/" }) {
  return <Link className="brand" href={href}><Image src={logo} alt="ARKNP" sizes="9rem"/></Link>;
}
