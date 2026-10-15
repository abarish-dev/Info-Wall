"""Republic (RPA) marketing-carrier guess from the route (real adsbdb routes)."""
import server

P = server._rpa_partner


def test_real_routes():
    assert P("IND", "EWR") == ("UAL", "United Express")
    assert P("IND", "LGA") == ("DAL", "Delta Connect")
    assert P("PVD", "DCA") == ("AAL", "American Eagle")   # DCA = American's hub
    assert P("IAH", "PHL") is None                          # UA vs AA -> Republic
    assert P("EWR", "YUL") == ("UAL", "United Express")
    assert P("CLT", "BDL") == ("AAL", "American Eagle")
    assert P("CLE", "CLT") is None                          # UA vs AA conflict


def test_shared_hubs_and_unknowns():
    assert P("ORD", "IND") is None            # shared UA/AA, other end no hub
    assert P("JFK", "BOS") == ("DAL", "Delta Connect")  # shared JFK narrowed by BOS
    assert P("JFK", "PHL") == ("AAL", "American Eagle")
    assert P("LAX", "SFO") == ("UAL", "United Express")
    assert P("LAX", "PHX") == ("AAL", "American Eagle")
    assert P("IND", "BNA") is None            # no hub at either end
    assert P(None, None) is None and P("", "ewr") == ("UAL", "United Express")
