import Link from "next/link";
import Image from "next/image";
import logo from "../../public/Modern ARKNP NFC Logo.png";
import { PublicLayout, ContactDetails } from "./_components/public";
export default function Home() {
  return <PublicLayout><section className="hero"><div><h1>Smart NFC<br/>solutions.</h1><p>NFC products and business technology services.</p><Link className="button" href="/contact">Contact ARKNP</Link></div><div className="hero-visual"><Image src={logo} alt="ARKNP logo" sizes="(max-width: 740px) 88vw, 38vw"/></div></section>
    <section className="home-contact"><div><h2>About ARKNP</h2><p>Contact our team for NFC product enquiries and customer support.</p></div><ContactDetails/></section></PublicLayout>;
}
